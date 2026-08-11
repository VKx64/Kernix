<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\OliverAction;
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

    public function test_a_read_only_question_records_no_actions(): void
    {
        $this->fakeReply('You have three open tasks; the shoot task is closest to due.', []);

        $response = $this->postJson('/api/oliver/messages', ['body' => 'What should I work on today?'])
            ->assertOk()
            ->assertJsonPath('data.message.actions', []);

        $this->assertSame([], $response->json('data.message.actions'));
        $this->assertSame(0, OliverAction::query()->count());
    }

    /**
     * The read-only guarantee does not depend on the model remembering to send
     * an empty `actions` array: a turn marked `intent: "answer"` has whatever
     * is in `actions` discarded server-side before it ever reaches the runner.
     */
    public function test_a_reply_marked_answer_never_runs_the_actions_it_carries(): void
    {
        $this->fakeReply(
            'Your top task is the shoot; want me to bump its priority?',
            [$this->action('create_task', ['project_id' => $this->project->id, 'title' => 'Should never exist'])],
            null,
            'answer',
        );

        $response = $this->postJson('/api/oliver/messages', ['body' => 'What should I work on today?'])
            ->assertOk()
            ->assertJsonPath('data.message.actions', []);

        $this->assertSame([], $response->json('data.message.actions'));
        $this->assertDatabaseMissing('tasks', ['title' => 'Should never exist']);
        $this->assertSame(0, OliverAction::query()->count());
    }

    public function test_a_permission_denied_action_is_not_recorded_or_offered_for_undo(): void
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

        // Nothing here can be mistaken for a completed action: no action_id to
        // undo, and nothing left behind for the rail's "acted today" log.
        $this->assertSame('refused', $actions[0]['status']);
        $this->assertArrayNotHasKey('action_id', $actions[0]);
        $this->assertSame(0, OliverAction::query()->count());
    }

    public function test_the_clock_state_reaches_the_model_and_follows_a_change_made_mid_conversation(): void
    {
        // Clocked in by setUp, so the first turn sees a working teammate.
        $context = $this->captureContext();
        $this->postJson('/api/oliver/messages', ['body' => 'What is on my plate?'])->assertOk();
        $clock = $context()['teammate']['clock'];
        $this->assertSame('working', $clock['state']);
        $this->assertTrue($clock['may_change_task_work']);
        $this->assertNotNull($clock['since']);

        // Clocking out between turns has to show up on the next one rather than
        // being remembered from the first.
        TimeSession::query()->where('user_id', $this->admin->id)->update(['clock_out_at' => now()]);
        $context = $this->captureContext();
        $this->postJson('/api/oliver/messages', ['body' => 'Still there?'])->assertOk();
        $clock = $context()['teammate']['clock'];
        $this->assertSame('clocked_out', $clock['state']);
        $this->assertFalse($clock['may_change_task_work']);
    }

    public function test_a_teammate_on_a_break_is_described_as_such_rather_than_as_clocked_out(): void
    {
        $session = TimeSession::query()->where('user_id', $this->admin->id)->firstOrFail();
        $session->breaks()->create(['start_at' => now()]);

        $context = $this->captureContext();
        $this->postJson('/api/oliver/messages', ['body' => 'Anything urgent?'])->assertOk();

        $clock = $context()['teammate']['clock'];
        $this->assertSame('break', $clock['state']);
        $this->assertFalse($clock['may_change_task_work']);
    }

    public function test_the_context_agrees_with_what_the_gate_would_actually_do(): void
    {
        // The whole point of reading both from one place: a turn that reports
        // the teammate may change work must be a turn whose actions survive.
        TimeSession::query()->where('user_id', $this->admin->id)->update(['clock_out_at' => now()]);
        $context = $this->captureContext('Adding that task.', [
            $this->action('create_task', ['project_id' => $this->project->id, 'title' => 'Blocked by the clock']),
        ], 'act');

        $response = $this->postJson('/api/oliver/messages', ['body' => 'Add a task for the reshoot'])->assertOk();

        $this->assertFalse($context()['teammate']['clock']['may_change_task_work']);
        $this->assertSame('refused', $response->json('data.message.actions.0.status'));
        $this->assertDatabaseMissing('tasks', ['title' => 'Blocked by the clock']);
    }

    public function test_oliver_is_unavailable_while_the_feature_is_switched_off(): void
    {
        SystemSetting::query()->firstOrFail()->update([AiFeatures::enabledColumn(AiFeatures::OLIVER) => false]);

        $this->getJson('/api/oliver')->assertOk()->assertJsonPath('data.available', false);
        $this->postJson('/api/oliver/messages', ['body' => 'Hello?'])->assertStatus(409);
    }

    /**
     * Stands in for the model and hands back the context it was given.
     *
     * The context is what the model reasons from, so asserting on the reply
     * would only prove the stub said what it was told to. Returns a closure
     * because the call has not happened yet when this is set up.
     *
     * @param  array<int, array<string, mixed>>  $actions
     * @return callable(): array<string, mixed>
     */
    private function captureContext(string $reply = 'Noted.', array $actions = [], string $intent = 'answer'): callable
    {
        $seen = null;
        $client = Mockery::mock(OpenRouterClient::class);
        $client->shouldReceive('structured')
            ->once()
            ->andReturnUsing(function (...$arguments) use (&$seen, $reply, $actions, $intent): array {
                $seen = json_decode((string) $arguments[2], true, 512, JSON_THROW_ON_ERROR);

                return [
                    'output' => ['reply' => $reply, 'intent' => $intent, 'actions' => $actions],
                    'cost_usd' => 0.0,
                    'actual_model' => 'test/model',
                ];
            });
        $this->app->instance(OpenRouterClient::class, $client);

        return function () use (&$seen): array {
            $this->assertIsArray($seen, 'The model was never called, so no context was captured.');

            return $seen;
        };
    }

    /**
     * @param  array<int, array<string, mixed>>  $actions
     */
    private function fakeReply(string $reply, array $actions, ?callable $before = null, string $intent = 'act'): void
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
            'output' => ['reply' => $reply, 'intent' => $intent, 'actions' => $actions],
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
