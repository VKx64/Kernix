<?php

namespace Tests\Feature;

use App\Models\AiTaskGeneration;
use App\Models\Client;
use App\Models\FieldValue;
use App\Models\Project;
use App\Models\ProjectMemoryEntry;
use App\Models\SystemSetting;
use App\Models\Task;
use App\Models\TimeSession;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AiTaskCreationMemoryTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private Project $project;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed();
        $this->admin = User::query()->findOrFail(1);
        Sanctum::actingAs($this->admin);
        TimeSession::query()->create(['user_id' => $this->admin->id, 'clock_in_at' => now()]);
        SystemSetting::query()->firstOrFail()->update([
            'openrouter_api_key' => 'test-openrouter-key',
            'openrouter_model' => 'test/structured-model',
            'ai_monthly_budget_usd' => 50,
        ]);
        $client = Client::query()->create(['name' => 'AI test client', 'created_by' => $this->admin->id]);
        $this->project = Project::query()->create([
            'client_id' => $client->id,
            'name' => 'AI delivery project',
            'description' => 'Prepare and deliver a client launch.',
            'manager_user_id' => $this->admin->id,
            'due_date' => now()->addMonth()->toDateString(),
            'ai_task_creation_enabled' => true,
            'ai_memory_enabled' => true,
            'created_by' => $this->admin->id,
        ]);
        $this->project->members()->syncWithoutDetaching([$this->admin->id => ['assigned_by' => $this->admin->id]]);
    }

    public function test_clear_prompt_creates_an_atomic_batch_and_untouched_batch_can_be_undone(): void
    {
        Http::fake(['openrouter.ai/*' => Http::response($this->completion([
            'mode' => 'create', 'question' => null, 'summary' => 'Launch work created.',
            'tasks' => [
                ['title' => 'Plan launch', 'description' => 'Confirm scope.', 'urgency' => 'high', 'due_date' => now()->addDays(5)->toDateString(), 'assignee_user_id' => $this->admin->id, 'estimated_minutes' => 60, 'subtasks' => ['Confirm deliverables']],
                ['title' => 'Quality check', 'description' => null, 'urgency' => 'normal', 'due_date' => null, 'assignee_user_id' => $this->admin->id, 'estimated_minutes' => 30, 'subtasks' => []],
            ],
        ]), 200)]);

        $response = $this->postJson('/api/projects/'.$this->project->id.'/ai-task-generations', ['prompt' => 'Prepare the client launch.'])
            ->assertAccepted();
        $generation = AiTaskGeneration::query()->findOrFail($response->json('data.id'));
        $this->assertSame('created', $generation->status);
        $this->assertCount(2, $generation->generatedTasks);
        $this->assertSame(2, Task::query()->where('ai_task_generation_id', $generation->id)->count());
        Http::assertSentCount(1);

        $this->postJson('/api/ai-task-generations/'.$generation->id.'/undo')->assertOk()->assertJsonPath('data.status', 'undone');
        $this->assertSame(0, Task::query()->where('ai_task_generation_id', $generation->id)->count());
        $this->assertSame(2, Task::withTrashed()->where('ai_task_generation_id', $generation->id)->count());
    }

    public function test_clarification_reply_makes_exactly_one_additional_call_then_creates(): void
    {
        Http::fakeSequence()
            ->push($this->completion(['mode' => 'clarify', 'question' => 'Which launch date should I plan around?', 'summary' => 'A launch date is required.', 'tasks' => []]))
            ->push($this->completion(['mode' => 'create', 'question' => null, 'summary' => 'Plan created.', 'tasks' => [[
                'title' => 'Prepare launch plan', 'description' => null, 'urgency' => 'normal', 'due_date' => now()->addDays(7)->toDateString(), 'assignee_user_id' => null, 'estimated_minutes' => null, 'subtasks' => [],
            ]]]));

        $response = $this->postJson('/api/projects/'.$this->project->id.'/ai-task-generations', ['prompt' => 'Plan the launch.'])->assertAccepted();
        $generation = AiTaskGeneration::query()->findOrFail($response->json('data.id'));
        $this->assertSame('needs_input', $generation->status);
        $this->postJson('/api/ai-task-generations/'.$generation->id.'/messages', ['message' => now()->addDays(10)->toDateString()])->assertAccepted();
        $this->assertSame('created', $generation->fresh()->status);
        Http::assertSentCount(2);
    }

    public function test_completion_proposes_only_pending_memory_and_reopening_supersedes_it(): void
    {
        Http::fake(['openrouter.ai/*' => Http::response($this->completion(['lessons' => [[
            'category' => 'workflow', 'content' => 'Run client QA before final handoff.', 'evidence' => 'The completed task recorded QA before delivery.', 'importance' => 4,
        ]]]), 200)]);
        $pending = $this->field('task_status', 'pending');
        $complete = $this->field('task_status', 'complete');
        $task = Task::query()->create(['project_id' => $this->project->id, 'title' => 'Deliver launch assets', 'description' => 'QA then hand off.', 'status_value_id' => $pending, 'estimated_minutes' => 60, 'actual_minutes' => 75, 'assignee_user_id' => $this->admin->id, 'created_by' => $this->admin->id]);
        $task->notes()->create(['body' => 'QA caught a mismatch before delivery.', 'is_message' => false, 'created_by' => $this->admin->id]);

        $this->patchJson('/api/tasks/'.$task->id, ['status_value_id' => $complete])->assertOk();
        $entry = ProjectMemoryEntry::query()->where('source_task_id', $task->id)->firstOrFail();
        $this->assertSame('pending', $entry->status);
        $this->assertDatabaseMissing('project_memory_entries', ['source_task_id' => $task->id, 'status' => 'approved']);

        $this->patchJson('/api/tasks/'.$task->id, ['status_value_id' => $pending])->assertOk();
        $this->assertSame('superseded', $entry->fresh()->status);
        Http::assertSentCount(1);
    }

    /** @param array<string, mixed> $output */
    private function completion(array $output): array
    {
        return [
            'id' => 'gen-test-'.uniqid(), 'model' => 'test/structured-model',
            'choices' => [['message' => ['content' => json_encode($output)]]],
            'usage' => ['prompt_tokens' => 20, 'completion_tokens' => 10, 'total_tokens' => 30, 'cost' => 0.001],
        ];
    }

    private function field(string $field, string $key): int
    {
        return (int) FieldValue::query()->where('key_name', $key)->whereHas('field', fn ($query) => $query->where('key_name', $field))->valueOrFail('id');
    }
}
