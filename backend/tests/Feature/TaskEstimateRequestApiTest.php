<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Project;
use App\Models\Role;
use App\Models\Task;
use App\Models\TaskEstimateRequest;
use App\Models\TaskNote;
use App\Models\SystemSetting;
use App\Models\TimeBreak;
use App\Models\TimeSession;
use App\Models\User;
use App\Services\AiEstimateInactivityService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class TaskEstimateRequestApiTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private User $employee;
    private User $manager;
    private Project $project;
    private Task $task;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed();
        $this->admin = User::query()->findOrFail(1);
        $this->employee = $this->userWith('Estimate requester', [
            'dashboard.view', 'tasks.view', 'tasks.comment', 'messages.view', 'time.track', 'tasks.request_estimate',
        ]);
        $this->manager = $this->userWith('Estimate reviewer', [
            'dashboard.view', 'tasks.view', 'tasks.comment', 'messages.view', 'time.track', 'tasks.estimate', 'tasks.review_estimate_requests',
        ]);
        $client = Client::query()->create(['name' => 'Estimate client', 'created_by' => $this->admin->id]);
        $this->project = Project::query()->create([
            'client_id' => $client->id,
            'name' => 'Estimate project',
            'manager_user_id' => $this->manager->id,
            'created_by' => $this->admin->id,
        ]);
        $this->task = Task::query()->create([
            'project_id' => $this->project->id,
            'title' => 'Estimate-aware task',
            'assignee_user_id' => $this->employee->id,
            'estimated_minutes' => 60,
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);
        $this->clockIn($this->employee);
        $this->clockIn($this->manager);
    }

    public function test_assignee_request_replaces_pending_request_and_starts_a_single_conversation(): void
    {
        Sanctum::actingAs($this->employee);
        $first = $this->postJson("/api/tasks/{$this->task->id}/estimate-requests", [
            'additional_minutes' => 30,
            'reason' => 'The source material needs cleanup.',
        ])->assertCreated()
            ->assertJsonPath('data.status', 'pending')
            ->assertJsonPath('data.requested_additional_minutes', 30);

        $second = $this->postJson("/api/tasks/{$this->task->id}/estimate-requests", [
            'additional_minutes' => 45,
            'reason' => 'Cleanup and a second review are now required.',
        ])->assertCreated();

        $this->assertDatabaseHas('task_estimate_requests', [
            'id' => $first->json('data.id'),
            'status' => 'replaced',
            'replaced_by_id' => $second->json('data.id'),
        ]);
        $this->assertDatabaseHas('task_estimate_requests', [
            'id' => $second->json('data.id'),
            'status' => 'pending',
            'requested_additional_minutes' => 45,
        ]);
        $this->assertSame(2, TaskNote::query()->whereNotNull('estimate_request_id')->whereColumn('id', 'conversation_id')->count());

        $conversationId = $second->json('data.conversation_id');
        $this->postJson("/api/messages/{$conversationId}/replies", [
            'body' => 'I can provide the cleaned source list if helpful.',
        ])->assertCreated();
        $this->getJson("/api/messages/{$conversationId}")
            ->assertOk()
            ->assertJsonCount(2, 'data.messages');
    }

    public function test_current_manager_can_counteroffer_and_approval_updates_estimate_immediately(): void
    {
        Sanctum::actingAs($this->employee);
        $request = $this->postJson("/api/tasks/{$this->task->id}/estimate-requests", [
            'additional_minutes' => 40,
            'reason' => 'The review uncovered another production pass.',
        ])->assertCreated();

        Sanctum::actingAs($this->manager);
        $this->postJson("/api/tasks/{$this->task->id}/estimate-requests/{$request->json('data.id')}/approve", [
            'approved_additional_minutes' => 25,
            'reason' => 'Approved for one focused additional pass.',
        ])->assertOk()
            ->assertJsonPath('data.status', 'approved')
            ->assertJsonPath('data.approved_additional_minutes', 25)
            ->assertJsonPath('data.decision_reason', 'Approved for one focused additional pass.');

        $this->assertSame(85, (int) $this->task->fresh()->estimated_minutes);
        $this->assertDatabaseHas('task_notes', [
            'estimate_request_id' => $request->json('data.id'),
            'created_by' => $this->manager->id,
            'assigned_user_id' => $this->employee->id,
            'body' => 'Approved for one focused additional pass.',
        ]);
    }

    public function test_only_assignee_and_current_manager_can_act_and_break_guard_still_applies(): void
    {
        $outsider = $this->userWith('Estimate outsider', [
            'dashboard.view', 'tasks.view', 'tasks.comment', 'messages.view', 'time.track', 'tasks.request_estimate',
        ]);
        $this->clockIn($outsider);
        Sanctum::actingAs($outsider);
        $this->postJson("/api/tasks/{$this->task->id}/estimate-requests", [
            'additional_minutes' => 10,
            'reason' => 'I should not be able to request this.',
        ])->assertForbidden();

        Sanctum::actingAs($this->employee);
        $request = $this->postJson("/api/tasks/{$this->task->id}/estimate-requests", [
            'additional_minutes' => 20,
            'reason' => 'A valid employee request.',
        ])->assertCreated();

        $newManager = $this->userWith('New estimate reviewer', [
            'dashboard.view', 'tasks.view', 'tasks.comment', 'messages.view', 'time.track', 'tasks.estimate', 'tasks.review_estimate_requests',
        ]);
        $session = $this->clockIn($newManager);
        $this->project->update(['manager_user_id' => $newManager->id]);

        Sanctum::actingAs($this->manager);
        $this->postJson("/api/tasks/{$this->task->id}/estimate-requests/{$request->json('data.id')}/reject", [
            'reason' => 'A former manager cannot decide.',
        ])->assertForbidden();

        TimeBreak::query()->create(['session_id' => $session->id, 'start_at' => now()]);
        Sanctum::actingAs($newManager);
        $this->postJson("/api/tasks/{$this->task->id}/estimate-requests/{$request->json('data.id')}/reject", [
            'reason' => 'This decision must wait until after break.',
        ])->assertStatus(409)->assertJsonPath('code', 'BREAK_ACTIVE');
        $this->assertSame('pending', TaskEstimateRequest::query()->findOrFail($request->json('data.id'))->status);
    }

    public function test_ai_reviews_each_employee_message_once_and_manager_can_override_the_final_decision(): void
    {
        SystemSetting::firstOrFail()->update([
            'openrouter_api_key' => 'test-openrouter-secret',
            'openrouter_model' => 'test/strict-manager',
            'ai_monthly_budget_usd' => 25,
        ]);
        $this->project->update([
            'ai_estimate_review_enabled' => true,
            'ai_estimate_review_rules' => 'Require a count of remaining assets.',
        ]);
        Http::fakeSequence()
            ->push($this->openRouterResponse('challenge', 'List the remaining assets and minutes per asset.', null, 'run-1'))
            ->push($this->openRouterResponse('approve', 'Six assets at five minutes each justify a 30-minute counteroffer.', 30, 'run-2'));

        Sanctum::actingAs($this->employee);
        $created = $this->postJson("/api/tasks/{$this->task->id}/estimate-requests", [
            'additional_minutes' => 45,
            'reason' => 'New source assets arrived after planning.',
        ])->assertCreated()->assertJsonPath('data.review_mode', 'ai');
        $requestId = $created->json('data.id');
        $conversationId = $created->json('data.conversation_id');
        $this->assertDatabaseHas('task_estimate_requests', [
            'id' => $requestId,
            'status' => 'pending',
            'ai_state' => 'waiting_employee',
        ]);
        $this->assertDatabaseHas('task_notes', [
            'estimate_request_id' => $requestId,
            'actor_type' => 'ai',
            'body' => 'List the remaining assets and minutes per asset.',
        ]);

        $this->postJson("/api/messages/{$conversationId}/replies", [
            'body' => 'Six remaining assets need five minutes each; the other work is complete.',
        ])->assertCreated();
        $this->assertDatabaseHas('task_estimate_requests', [
            'id' => $requestId,
            'status' => 'approved',
            'approved_additional_minutes' => 30,
            'effective_additional_minutes' => 30,
            'decision_source' => 'ai',
        ]);
        $this->assertSame(90, (int) $this->task->fresh()->estimated_minutes);
        Http::assertSentCount(2);
        Http::assertSent(fn ($request) => $request['provider']['zdr'] === true
            && $request['response_format']['type'] === 'json_schema'
            && $request['model'] === 'test/strict-manager');

        Sanctum::actingAs($this->manager);
        $this->postJson("/api/tasks/{$this->task->id}/estimate-requests/{$requestId}/override", [
            'action' => 'reject',
            'reason' => 'The six assets were removed from scope after the AI decision.',
        ])->assertOk()
            ->assertJsonPath('data.status', 'rejected')
            ->assertJsonPath('data.decision_source', 'human_override');
        $this->assertSame(60, (int) $this->task->fresh()->estimated_minutes);
        $this->assertDatabaseCount('task_estimate_decisions', 2);
    }

    public function test_openrouter_failure_leaves_request_pending_for_human_review_and_never_exposes_key(): void
    {
        SystemSetting::firstOrFail()->update([
            'openrouter_api_key' => 'never-return-this-secret',
            'openrouter_model' => 'test/strict-manager',
        ]);
        $this->project->update(['ai_estimate_review_enabled' => true]);
        Http::fake(['openrouter.ai/*' => Http::response(['error' => ['message' => 'Provider unavailable']], 529)]);

        Sanctum::actingAs($this->employee);
        $created = $this->postJson("/api/tasks/{$this->task->id}/estimate-requests", [
            'additional_minutes' => 20,
            'reason' => 'A documented scope change requires another export.',
        ])->assertCreated();
        $this->assertDatabaseHas('task_estimate_requests', [
            'id' => $created->json('data.id'),
            'status' => 'pending',
            'ai_state' => 'failed',
        ]);
        Http::assertSentCount(1);

        Sanctum::actingAs($this->admin);
        $this->getJson('/api/settings')->assertOk()
            ->assertJsonMissing(['openrouter_api_key' => 'never-return-this-secret'])
            ->assertJsonPath('data.has_openrouter_api_key', true);
    }

    public function test_unanswered_ai_challenge_is_rejected_after_the_configured_window(): void
    {
        SystemSetting::firstOrFail()->update([
            'openrouter_api_key' => 'test-openrouter-secret',
            'openrouter_model' => 'test/strict-manager',
            'ai_inactivity_hours' => 48,
        ]);
        $this->project->update(['ai_estimate_review_enabled' => true]);
        Http::fake([
            'openrouter.ai/*' => Http::response(
                $this->openRouterResponse('challenge', 'Provide the measurable remaining work.', null, 'run-timeout')
            ),
        ]);

        Sanctum::actingAs($this->employee);
        $created = $this->postJson("/api/tasks/{$this->task->id}/estimate-requests", [
            'additional_minutes' => 20,
            'reason' => 'I need more time.',
        ])->assertCreated();
        TaskEstimateRequest::query()->whereKey($created->json('data.id'))->update([
            'awaiting_employee_since' => now()->subHours(49),
        ]);

        $this->assertSame(1, app(AiEstimateInactivityService::class)->rejectInactive());
        $this->assertDatabaseHas('task_estimate_requests', [
            'id' => $created->json('data.id'),
            'status' => 'rejected',
            'decision_source' => 'system',
            'effective_additional_minutes' => 0,
        ]);
        $this->assertSame(60, (int) $this->task->fresh()->estimated_minutes);
    }

    private function openRouterResponse(string $action, string $message, ?int $approved, string $id): array
    {
        return [
            'id' => $id,
            'model' => 'test/strict-manager',
            'choices' => [['message' => ['content' => json_encode([
                'action' => $action,
                'message' => $message,
                'evidence_summary' => ['Task-scoped evidence only.'],
                'approved_additional_minutes' => $approved,
            ])]]],
            'usage' => ['prompt_tokens' => 100, 'completion_tokens' => 20, 'total_tokens' => 120, 'cost' => 0.001],
        ];
    }

    private function userWith(string $name, array $permissions): User
    {
        $role = Role::query()->create([
            'name' => $name,
            'key_name' => str($name)->slug('_').'_'.str()->lower(str()->random(6)),
        ]);
        $role->permissions()->createMany(array_map(
            fn (string $permission): array => ['permission_key' => $permission],
            $permissions,
        ));

        return User::factory()->create(['role_id' => $role->id]);
    }

    private function clockIn(User $user): TimeSession
    {
        return TimeSession::query()->create(['user_id' => $user->id, 'clock_in_at' => now()]);
    }
}
