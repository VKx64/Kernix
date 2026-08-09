<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\FieldValue;
use App\Models\OliverAction;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskNote;
use App\Models\User;
use App\Services\OliverActionRunner;
use App\Support\TaskSignals;
use App\Support\TaskStatuses;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Oliver acts directly, so Undo is the whole safety net. These tests care about
 * two things: that a reversal puts back exactly what changed, and that it
 * refuses rather than overwriting anything that happened since.
 */
class OliverUndoTest extends TestCase
{
    use RefreshDatabase;

    private const NOW = '2026-08-12 10:00:00';

    private User $user;

    private User $other;

    private Project $project;

    protected function setUp(): void
    {
        parent::setUp();

        TaskStatuses::flush();
        TaskSignals::flush();
        $this->seed();
        $this->travelTo(Carbon::parse(self::NOW));

        $this->user = User::query()->findOrFail(1);
        $this->other = User::factory()->create([
            'role_id' => $this->user->role_id,
            'first_name' => 'Liam',
            'last_name' => 'Cruz',
        ]);
        $client = Client::query()->create(['name' => 'Northwind', 'created_by' => $this->user->id]);
        $this->project = Project::query()->create([
            'client_id' => $client->id,
            'name' => 'Website Relaunch',
            'created_by' => $this->user->id,
        ]);

        Sanctum::actingAs($this->user);
    }

    public function test_a_successful_action_is_logged_and_listed_newest_first(): void
    {
        $task = $this->makeTask('Fix checkout');
        $this->oliver([
            ['type' => 'create_task', 'project_id' => $this->project->id, 'title' => 'Book the studio'],
            ['type' => 'assign_task', 'task_id' => $task->id, 'assignee_user_id' => $this->other->id],
        ]);

        $rows = $this->getJson('/api/oliver/actions')->assertOk()->json('data');

        $this->assertSame(['assign_task', 'create_task'], array_column($rows, 'type'));
        $this->assertSame('Assigned “Fix checkout” to Liam', $rows[0]['summary']);
        $this->assertSame('Task', $rows[0]['entity_type']);
        $this->assertSame($task->id, $rows[0]['entity_id']);
        $this->assertNull($rows[0]['undone_at']);
    }

    public function test_a_refused_action_logs_nothing(): void
    {
        $results = $this->oliver([
            ['type' => 'create_task', 'project_id' => $this->project->id, 'title' => ''],
            ['type' => 'update_task', 'task_id' => 0, 'title' => 'Nope'],
            ['type' => 'burn_the_office_down'],
        ]);

        $this->assertSame(['refused', 'refused', 'refused'], array_column($results, 'status'));
        $this->assertSame(0, OliverAction::query()->count());
    }

    public function test_undoing_a_created_task_archives_it_rather_than_deleting_it(): void
    {
        $this->oliver([['type' => 'create_task', 'project_id' => $this->project->id, 'title' => 'Book the studio']]);
        $action = OliverAction::query()->firstOrFail();

        $this->postJson("/api/oliver/actions/{$action->id}/undo")
            ->assertOk()
            ->assertJsonPath('data.type', 'create_task');

        $task = Task::query()->findOrFail($action->entity_id);
        $this->assertNotNull($task->archived_at);
        $this->assertNull($task->deleted_at);
        $this->assertNotNull($action->fresh()->undone_at);
        $this->assertDatabaseHas('audit_logs', ['action' => 'oliver.undo', 'entity_id' => $action->id]);
    }

    public function test_undoing_an_update_restores_only_the_fields_that_changed(): void
    {
        $task = $this->makeTask('Fix checkout', [
            'description' => 'Original brief',
            'due_date' => '2026-08-20',
            'estimated_minutes' => 60,
        ]);

        $this->oliver([[
            'type' => 'update_task',
            'task_id' => $task->id,
            'title' => 'Fix the broken checkout',
            'due_date' => '2026-08-25',
            'status' => 'In Progress',
        ]]);

        $changed = $task->fresh();
        $this->assertSame('Fix the broken checkout', $changed->title);
        $this->assertSame('2026-08-25', $changed->due_date->toDateString());

        $action = OliverAction::query()->firstOrFail();
        $this->assertSame(
            ['title' => 'Fix checkout', 'due_date' => '2026-08-20', 'status_value_id' => $this->statusId('pending')],
            $action->before,
        );

        $this->postJson("/api/oliver/actions/{$action->id}/undo")->assertOk();

        $restored = $task->fresh();
        $this->assertSame('Fix checkout', $restored->title);
        $this->assertSame('2026-08-20', $restored->due_date->toDateString());
        $this->assertSame($this->statusId('pending'), (int) $restored->status_value_id);
        // Untouched fields stay untouched by the reversal too.
        $this->assertSame('Original brief', $restored->description);
        $this->assertSame(60, (int) $restored->estimated_minutes);
    }

    public function test_undoing_an_assignment_hands_the_task_back(): void
    {
        $task = $this->makeTask('Fix checkout', ['assignee_user_id' => $this->user->id]);
        $this->oliver([['type' => 'assign_task', 'task_id' => $task->id, 'assignee_user_id' => $this->other->id]]);
        $this->assertSame($this->other->id, (int) $task->fresh()->assignee_user_id);

        $action = OliverAction::query()->firstOrFail();
        $this->postJson("/api/oliver/actions/{$action->id}/undo")->assertOk();

        $this->assertSame($this->user->id, (int) $task->fresh()->assignee_user_id);
    }

    public function test_undoing_a_comment_soft_deletes_the_note(): void
    {
        $task = $this->makeTask('Fix checkout');
        $this->oliver([['type' => 'comment_task', 'task_id' => $task->id, 'body' => 'Checked the logs, nothing there.']]);

        $note = TaskNote::query()->where('task_id', $task->id)->firstOrFail();
        $action = OliverAction::query()->firstOrFail();

        $this->postJson("/api/oliver/actions/{$action->id}/undo")->assertOk();

        $this->assertNull(TaskNote::query()->find($note->id));
        $this->assertNotNull(TaskNote::withTrashed()->findOrFail($note->id)->deleted_at);
    }

    public function test_only_the_person_the_action_belongs_to_can_undo_it(): void
    {
        $task = $this->makeTask('Fix checkout', ['assignee_user_id' => $this->user->id]);
        $this->oliver([['type' => 'assign_task', 'task_id' => $task->id, 'assignee_user_id' => $this->other->id]]);
        $action = OliverAction::query()->firstOrFail();

        Sanctum::actingAs($this->other);
        $this->postJson("/api/oliver/actions/{$action->id}/undo")->assertForbidden();

        $this->assertSame($this->other->id, (int) $task->fresh()->assignee_user_id);
        $this->assertNull($action->fresh()->undone_at);
        // It is not even in the other person's list to begin with.
        $this->assertSame([], $this->getJson('/api/oliver/actions')->assertOk()->json('data'));
    }

    public function test_an_action_cannot_be_undone_twice(): void
    {
        $task = $this->makeTask('Fix checkout', ['assignee_user_id' => $this->user->id]);
        $this->oliver([['type' => 'assign_task', 'task_id' => $task->id, 'assignee_user_id' => $this->other->id]]);
        $action = OliverAction::query()->firstOrFail();

        $this->postJson("/api/oliver/actions/{$action->id}/undo")->assertOk();
        $this->postJson("/api/oliver/actions/{$action->id}/undo")
            ->assertStatus(409)
            ->assertJsonPath('message', 'That action has already been undone.');
    }

    public function test_a_later_edit_by_somebody_else_blocks_the_undo(): void
    {
        $task = $this->makeTask('Fix checkout', ['due_date' => '2026-08-20']);
        $this->oliver([['type' => 'update_task', 'task_id' => $task->id, 'title' => 'Fix the broken checkout']]);
        $action = OliverAction::query()->firstOrFail();

        Task::query()->whereKey($task->id)->update(['title' => 'Fix the broken checkout urgently']);

        $this->postJson("/api/oliver/actions/{$action->id}/undo")
            ->assertStatus(409)
            ->assertJsonPath('message', 'That has changed since Oliver touched it, so undoing now would overwrite the newer edit.');

        // Nothing was clobbered: the newer title and the untouched due date stand.
        $fresh = $task->fresh();
        $this->assertSame('Fix the broken checkout urgently', $fresh->title);
        $this->assertSame('2026-08-20', $fresh->due_date->toDateString());
        $this->assertNull($action->fresh()->undone_at);
    }

    public function test_a_later_edit_to_the_note_blocks_the_comment_undo(): void
    {
        $task = $this->makeTask('Fix checkout');
        $this->oliver([['type' => 'comment_task', 'task_id' => $task->id, 'body' => 'Checked the logs.']]);
        $note = TaskNote::query()->where('task_id', $task->id)->firstOrFail();
        $note->update(['body' => 'Checked the logs, and the CDN too.']);
        $action = OliverAction::query()->firstOrFail();

        $this->postJson("/api/oliver/actions/{$action->id}/undo")->assertStatus(409);

        $this->assertNotNull(TaskNote::query()->find($note->id));
    }

    public function test_an_action_older_than_a_day_can_no_longer_be_undone(): void
    {
        $task = $this->makeTask('Fix checkout', ['assignee_user_id' => $this->user->id]);
        $this->oliver([['type' => 'assign_task', 'task_id' => $task->id, 'assignee_user_id' => $this->other->id]]);
        $action = OliverAction::query()->firstOrFail();
        OliverAction::query()->whereKey($action->id)->update(['created_at' => Carbon::parse(self::NOW)->subHours(25)]);

        $this->postJson("/api/oliver/actions/{$action->id}/undo")
            ->assertStatus(409)
            ->assertJsonPath('message', 'That action is more than a day old, so it can no longer be undone.');

        $this->assertSame($this->other->id, (int) $task->fresh()->assignee_user_id);
    }

    /**
     * @param  array<int, array<string, mixed>>  $actions
     * @return array<int, array<string, mixed>>
     */
    private function oliver(array $actions): array
    {
        return app(OliverActionRunner::class)->run($actions, $this->user->fresh());
    }

    /** @param array<string, mixed> $overrides */
    private function makeTask(string $title, array $overrides = []): Task
    {
        return Task::query()->create(array_merge([
            'project_id' => $this->project->id,
            'title' => $title,
            'status_value_id' => $this->statusId('pending'),
            'assignee_user_id' => $this->user->id,
            'actual_minutes' => 0,
            'created_by' => $this->user->id,
        ], $overrides));
    }

    private function statusId(string $key): int
    {
        return (int) FieldValue::query()->where('key_name', $key)
            ->whereHas('field', fn ($field) => $field->where('key_name', 'task_status'))->value('id');
    }
}
