<?php

namespace Tests\Feature;

use App\Jobs\AuditTaskCompletionProof;
use App\Models\Client;
use App\Models\Project;
use App\Models\Role;
use App\Models\SystemSetting;
use App\Models\Task;
use App\Models\TaskCompletionProof;
use App\Models\TimeSession;
use App\Models\User;
use App\Services\AiUsageService;
use App\Services\OpenRouterClient;
use App\Services\TaskCompletionAuditPrompt;
use App\Support\TaskStatuses;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\TestCase;

class TaskCompletionProofApiTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private Task $task;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        TaskStatuses::flush();
        $this->seed();
        $this->admin = User::query()->findOrFail(1);
        Sanctum::actingAs($this->admin);
        TimeSession::query()->create(['user_id' => $this->admin->id, 'clock_in_at' => now()]);

        $client = Client::query()->create(['name' => 'Proof client', 'created_by' => $this->admin->id]);
        $project = Project::query()->create([
            'client_id' => $client->id,
            'name' => 'Proof project',
            'created_by' => $this->admin->id,
        ]);
        $this->task = Task::query()->create([
            'project_id' => $project->id,
            'title' => 'Colour grade the trailer',
            'description' => 'Deliver a graded 4K master of the launch trailer.',
            'status_value_id' => TaskStatuses::id('in_progress'),
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);
    }

    public function test_submitting_proof_requires_a_summary_and_a_file_and_parks_the_task_in_quality_check(): void
    {
        Queue::fake();

        $this->post("/api/tasks/{$this->task->id}/completion-proofs", [
            'summary' => 'Done.',
        ])->assertStatus(422)
            ->assertJsonValidationErrors(['summary', 'files']);

        $this->post("/api/tasks/{$this->task->id}/completion-proofs", [
            'summary' => 'Graded the trailer and exported the 4K master for review.',
            'files' => [UploadedFile::fake()->create('master-frame.png', 40, 'image/png')],
        ])->assertCreated()
            ->assertJsonPath('data.status', 'pending')
            ->assertJsonPath('data.ai_state', 'queued')
            ->assertJsonPath('data.submitted_by.id', $this->admin->id);

        $this->assertSame(TaskStatuses::id(TaskStatuses::QUALITY_CHECK), (int) $this->task->fresh()->status_value_id);
        $this->assertSame(1, TaskCompletionProof::query()->count());
        $this->assertSame(1, $this->task->attachments()->whereNotNull('completion_proof_id')->count());
        Queue::assertPushed(AuditTaskCompletionProof::class);

        // A second submission cannot queue while one is still under review.
        $this->post("/api/tasks/{$this->task->id}/completion-proofs", [
            'summary' => 'Graded the trailer a second time for good measure.',
            'files' => [UploadedFile::fake()->create('again.png', 10, 'image/png')],
        ])->assertStatus(409);
    }

    public function test_complete_cannot_be_set_directly_without_approved_proof(): void
    {
        $employee = $this->employeeWithoutReviewRights();
        // This is a business-rule check (no direct path to complete), not an
        // assignment check, so make the employee the task's assignee.
        $this->task->update(['assignee_user_id' => $employee->id]);
        Sanctum::actingAs($employee);
        TimeSession::query()->create(['user_id' => $employee->id, 'clock_in_at' => now()]);

        $this->patchJson("/api/tasks/{$this->task->id}", [
            'status_value_id' => TaskStatuses::id(TaskStatuses::COMPLETE),
        ])->assertStatus(422);

        $this->assertNotSame(TaskStatuses::id(TaskStatuses::COMPLETE), (int) $this->task->fresh()->status_value_id);

        // A reviewer keeps the manual path open.
        Sanctum::actingAs($this->admin);
        $this->patchJson("/api/tasks/{$this->task->id}", [
            'status_value_id' => TaskStatuses::id(TaskStatuses::COMPLETE),
        ])->assertOk();
    }

    public function test_the_audit_completes_the_task_when_the_proof_holds_up(): void
    {
        $proof = $this->submitProof();
        $this->fakeAudit([
            'verdict' => 'approve',
            'message' => 'The exported master matches the requested deliverable.',
            'missing_evidence' => [],
        ]);

        (new AuditTaskCompletionProof($proof->id))->handle(
            app(OpenRouterClient::class),
            app(TaskCompletionAuditPrompt::class),
            app(AiUsageService::class),
        );

        $proof->refresh();
        $this->assertSame('approved', $proof->status);
        $this->assertSame('approve', $proof->ai_verdict);
        $this->assertSame('ai', $proof->review_mode);
        $this->assertSame(TaskStatuses::id(TaskStatuses::COMPLETE), (int) $this->task->fresh()->status_value_id);
        $this->assertSame(1, $this->task->notes()->where('actor_type', 'ai')->count());
    }

    public function test_a_thin_proof_sends_the_task_back_for_correction_with_reasons(): void
    {
        $proof = $this->submitProof();
        $this->fakeAudit([
            'verdict' => 'insufficient',
            'message' => 'The screenshot does not show a graded master.',
            'missing_evidence' => ['A frame from the exported 4K master', 'The export settings used'],
        ]);

        (new AuditTaskCompletionProof($proof->id))->handle(
            app(OpenRouterClient::class),
            app(TaskCompletionAuditPrompt::class),
            app(AiUsageService::class),
        );

        $proof->refresh();
        $this->assertSame('rejected', $proof->status);
        $this->assertSame(['A frame from the exported 4K master', 'The export settings used'], $proof->ai_missing_evidence);
        $this->assertSame(TaskStatuses::id(TaskStatuses::NEEDS_CORRECTION), (int) $this->task->fresh()->status_value_id);
        $this->assertStringContainsString('Still needed:', (string) $this->task->notes()->latest('id')->value('body'));
    }

    public function test_an_unavailable_auditor_parks_the_proof_for_a_human_reviewer(): void
    {
        $proof = $this->submitProof();
        SystemSetting::query()->firstOrFail()->update(['openrouter_api_key' => null, 'openrouter_model' => null]);

        (new AuditTaskCompletionProof($proof->id))->handle(
            app(OpenRouterClient::class),
            app(TaskCompletionAuditPrompt::class),
            app(AiUsageService::class),
        );

        $proof->refresh();
        $this->assertSame('pending', $proof->status);
        $this->assertSame('not_configured', $proof->ai_state);
        $this->assertTrue($proof->awaitsHumanReview());
        $this->assertSame(TaskStatuses::id(TaskStatuses::QUALITY_CHECK), (int) $this->task->fresh()->status_value_id);

        $this->postJson("/api/tasks/{$this->task->id}/completion-proofs/{$proof->id}/approve", [
            'reason' => 'Checked the delivered master by hand.',
        ])->assertOk()->assertJsonPath('data.review_mode', 'human');

        $this->assertSame(TaskStatuses::id(TaskStatuses::COMPLETE), (int) $this->task->fresh()->status_value_id);
        $this->postJson("/api/tasks/{$this->task->id}/completion-proofs/{$proof->id}/reject", ['reason' => 'Too late.'])
            ->assertStatus(409);
    }

    public function test_a_reviewer_rejection_needs_a_reason_and_reopens_the_task(): void
    {
        $proof = $this->submitProof();

        $this->postJson("/api/tasks/{$this->task->id}/completion-proofs/{$proof->id}/reject", [])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['reason']);

        $this->postJson("/api/tasks/{$this->task->id}/completion-proofs/{$proof->id}/reject", [
            'reason' => 'The master is the ungraded cut.',
        ])->assertOk()->assertJsonPath('data.status', 'rejected');

        $this->assertSame(TaskStatuses::id(TaskStatuses::NEEDS_CORRECTION), (int) $this->task->fresh()->status_value_id);
    }

    private function submitProof(): TaskCompletionProof
    {
        Queue::fake();
        $this->post("/api/tasks/{$this->task->id}/completion-proofs", [
            'summary' => 'Graded the trailer and exported the 4K master for review.',
            'files' => [UploadedFile::fake()->create('master-frame.png', 40, 'image/png')],
        ])->assertCreated();

        return TaskCompletionProof::query()->latest('id')->firstOrFail();
    }

    /** @param array<string, mixed> $output */
    private function fakeAudit(array $output): void
    {
        SystemSetting::query()->firstOrFail()->update([
            'openrouter_api_key' => 'test-key',
            'openrouter_model' => 'test/model',
        ]);
        $client = Mockery::mock(OpenRouterClient::class);
        $client->shouldReceive('structured')->once()->andReturn([
            'output' => $output,
            'cost_usd' => 0.0,
            'actual_model' => 'test/model',
        ]);
        $this->app->instance(OpenRouterClient::class, $client);
    }

    private function employeeWithoutReviewRights(): User
    {
        $employee = User::factory()->create();
        $role = Role::query()->create(['name' => 'Prover', 'key_name' => 'prover_role']);
        $employee->role()->associate($role);
        $employee->save();
        foreach (['dashboard.view', 'tasks.view', 'time.track', 'tasks.change_status'] as $key) {
            $role->permissions()->create(['permission_key' => $key]);
        }

        return $employee->fresh();
    }
}
