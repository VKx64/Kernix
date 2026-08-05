<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\OliverConversation;
use App\Models\Project;
use App\Models\Role;
use App\Models\SystemSetting;
use App\Models\Task;
use App\Models\TimeSession;
use App\Models\User;
use App\Services\OpenRouterClient;
use App\Support\AiFeatures;
use App\Support\TaskStatuses;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\TestCase;

class OliverChatTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private Project $project;

    protected function setUp(): void
    {
        parent::setUp();

        TaskStatuses::flush();
        $this->seed();
        $this->admin = User::query()->findOrFail(1);
        Sanctum::actingAs($this->admin);
        TimeSession::query()->create(['user_id' => $this->admin->id, 'clock_in_at' => now()]);
        SystemSetting::query()->firstOrFail()->update([
            'openrouter_api_key' => 'test-key',
            'openrouter_model' => 'test/model',
        ]);

        $client = Client::query()->create(['name' => 'Oliver client', 'created_by' => $this->admin->id]);
        $this->project = Project::query()->create([
            'client_id' => $client->id,
            'name' => 'Launch film',
            'created_by' => $this->admin->id,
        ]);
    }

    public function test_the_conversation_starts_empty_and_reports_availability(): void
    {
        $this->getJson('/api/oliver')
            ->assertOk()
            ->assertJsonPath('data.available', true)
            ->assertJsonCount(0, 'data.messages');
    }

    public function test_oliver_creates_and_assigns_work_and_records_what_he_did(): void
    {
        $mate = User::factory()->create(['role_id' => $this->admin->role_id, 'first_name' => 'Casey']);
        $this->fakeReply('Created the shoot task and assigned it to Casey.', [
            $this->action('create_task', ['project_id' => $this->project->id, 'title' => 'Book the studio', 'due_date' => now()->addWeek()->toDateString()]),
            $this->action('assign_task', ['task_id' => null, 'assignee_user_id' => $mate->id]),
        ], fn () => Task::query()->create([
            'project_id' => $this->project->id,
            'title' => 'Existing task',
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]));

        $response = $this->postJson('/api/oliver/messages', ['body' => 'Add a task to book the studio and give it to Casey.'])
            ->assertOk()
            ->assertJsonPath('data.message.role', 'assistant');

        $actions = $response->json('data.message.actions');
        $this->assertSame('done', $actions[0]['status']);
        $this->assertDatabaseHas('tasks', ['title' => 'Book the studio', 'project_id' => $this->project->id]);
        $this->assertSame(2, OliverConversation::query()->firstOrFail()->messages()->count());
        $this->assertDatabaseHas('audit_logs', ['action' => 'task.oliver.create']);
    }

    public function test_oliver_cannot_complete_a_task_or_exceed_the_asker_permissions(): void
    {
        $task = Task::query()->create([
            'project_id' => $this->project->id,
            'title' => 'Grade the trailer',
            'status_value_id' => TaskStatuses::id('in_progress'),
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);
        $this->fakeReply('Marking it complete.', [
            $this->action('update_task', ['task_id' => $task->id, 'status' => 'Complete']),
        ]);

        $actions = $this->postJson('/api/oliver/messages', ['body' => 'Mark the trailer task complete.'])
            ->assertOk()
            ->json('data.message.actions');

        $this->assertSame('refused', $actions[0]['status']);
        $this->assertStringContainsString('needs proof', $actions[0]['summary']);
        $this->assertSame(TaskStatuses::id('in_progress'), (int) $task->fresh()->status_value_id);
    }

    public function test_a_teammate_without_task_permissions_gets_the_action_refused(): void
    {
        $role = Role::query()->create(['name' => 'Reader', 'key_name' => 'reader_role']);
        foreach (['dashboard.view', 'messages.view', 'tasks.view'] as $key) {
            $role->permissions()->create(['permission_key' => $key]);
        }
        $reader = User::factory()->create(['role_id' => $role->id]);
        Sanctum::actingAs($reader->fresh());
        TimeSession::query()->create(['user_id' => $reader->id, 'clock_in_at' => now()]);
        $this->fakeReply('Adding that task.', [
            $this->action('create_task', ['project_id' => $this->project->id, 'title' => 'Sneaky task']),
        ]);

        $actions = $this->postJson('/api/oliver/messages', ['body' => 'Create a task for me.'])
            ->assertOk()
            ->json('data.message.actions');

        $this->assertSame('refused', $actions[0]['status']);
        $this->assertDatabaseMissing('tasks', ['title' => 'Sneaky task']);
    }

    public function test_oliver_is_unavailable_while_the_feature_is_switched_off(): void
    {
        SystemSetting::query()->firstOrFail()->update([AiFeatures::enabledColumn(AiFeatures::OLIVER) => false]);

        $this->getJson('/api/oliver')->assertOk()->assertJsonPath('data.available', false);
        $this->postJson('/api/oliver/messages', ['body' => 'Hello?'])->assertStatus(409);
    }

    /**
     * @param  array<int, array<string, mixed>>  $actions
     */
    private function fakeReply(string $reply, array $actions, ?callable $before = null): void
    {
        $created = $before ? $before() : null;
        $actions = array_map(function (array $action) use ($created) {
            if ($action['type'] === 'assign_task' && $action['task_id'] === null && $created instanceof Task) {
                $action['task_id'] = $created->id;
            }

            return $action;
        }, $actions);

        $client = Mockery::mock(OpenRouterClient::class);
        $client->shouldReceive('structured')->once()->andReturn([
            'output' => ['reply' => $reply, 'actions' => $actions],
            'cost_usd' => 0.0,
            'actual_model' => 'test/model',
        ]);
        $this->app->instance(OpenRouterClient::class, $client);
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function action(string $type, array $overrides = []): array
    {
        return array_merge([
            'type' => $type,
            'task_id' => null,
            'project_id' => null,
            'title' => null,
            'description' => null,
            'assignee_user_id' => null,
            'due_date' => null,
            'estimated_minutes' => null,
            'status' => null,
            'body' => null,
        ], $overrides);
    }
}
