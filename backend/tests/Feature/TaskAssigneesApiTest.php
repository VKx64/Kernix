<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\FieldValue;
use App\Models\Project;
use App\Models\Role;
use App\Models\Task;
use App\Models\TimeSession;
use App\Models\User;
use App\Support\TaskAssigneeSync;
use App\Support\WorkspaceProvisioner;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The multi-assignee pivot introduced this slice: the backfill migration,
 * legacy scalar compatibility, workspace-scoped validation, the tasks.assign
 * gate on the array key, and membership-based mine/unassigned/'none' reads.
 */
class TaskAssigneesApiTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed();
        $this->admin = User::query()->findOrFail(1);
        Sanctum::actingAs($this->admin);
        TimeSession::query()->create([
            'user_id' => $this->admin->id,
            'clock_in_at' => now(),
        ]);
    }

    public function test_migration_backfills_one_pivot_row_per_previously_assigned_task(): void
    {
        [, $project] = $this->workspace();
        $assignee = User::factory()->create();

        // Inserted directly so the row has no pivot entry and never touches
        // Task's saved() hook — this simulates data that existed before the
        // migration ran on a live database.
        $taskId = DB::table('tasks')->insertGetId([
            'project_id' => $project->id,
            'title' => 'Pre-existing legacy assignment',
            'assignee_user_id' => $assignee->id,
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $unassignedTaskId = DB::table('tasks')->insertGetId([
            'project_id' => $project->id,
            'title' => 'Pre-existing unassigned task',
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Schema::dropIfExists('task_assignees');
        $migration = require base_path('database/migrations/2026_08_15_000000_create_task_assignees_table.php');
        $migration->up();

        $this->assertSame(1, DB::table('task_assignees')->where('task_id', $taskId)->count());
        $this->assertDatabaseHas('task_assignees', [
            'task_id' => $taskId,
            'user_id' => $assignee->id,
        ]);
        $this->assertSame(0, DB::table('task_assignees')->where('task_id', $unassignedTaskId)->count());
    }

    public function test_legacy_scalar_assignee_user_id_still_assigns_through_the_pivot(): void
    {
        [, $project] = $this->workspace();
        $task = Task::query()->create([
            'project_id' => $project->id,
            'title' => 'Legacy scalar target',
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);
        $target = User::factory()->create();

        $this->patchJson("/api/tasks/{$task->id}", [
            'assignee_user_id' => $target->id,
        ])->assertOk()
            ->assertJsonPath('data.assignee_user_id', $target->id)
            ->assertJsonPath('data.task_assignees.0.id', $target->id)
            ->assertJsonCount(1, 'data.task_assignees');

        $this->assertDatabaseHas('task_assignees', ['task_id' => $task->id, 'user_id' => $target->id]);
        $this->assertSame($target->id, $task->fresh()->assignee_user_id);
    }

    public function test_null_scalar_detaches_every_assignee(): void
    {
        [, $project] = $this->workspace();
        $target = User::factory()->create();
        $task = Task::query()->create([
            'project_id' => $project->id,
            'title' => 'To be unassigned',
            'assignee_user_id' => $target->id,
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);
        $this->assertDatabaseHas('task_assignees', ['task_id' => $task->id, 'user_id' => $target->id]);

        $this->patchJson("/api/tasks/{$task->id}", [
            'assignee_user_id' => null,
        ])->assertOk()
            ->assertJsonPath('data.assignee_user_id', null)
            ->assertJsonCount(0, 'data.task_assignees');

        $this->assertNull($task->fresh()->assignee_user_id);
        $this->assertDatabaseMissing('task_assignees', ['task_id' => $task->id]);
    }

    public function test_assignee_user_ids_array_replaces_the_whole_set_in_order(): void
    {
        [, $project] = $this->workspace();
        $task = Task::query()->create([
            'project_id' => $project->id,
            'title' => 'Multi-assignee target',
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);
        $first = User::factory()->create();
        $second = User::factory()->create();

        $this->patchJson("/api/tasks/{$task->id}", [
            'assignee_user_ids' => [$first->id, $second->id],
        ])->assertOk()
            ->assertJsonPath('data.assignee_user_id', $first->id)
            ->assertJsonPath('data.task_assignees.0.id', $first->id)
            ->assertJsonPath('data.task_assignees.1.id', $second->id)
            ->assertJsonCount(2, 'data.task_assignees');

        $this->assertSame(
            [$first->id, $second->id],
            $task->fresh()->assignees()->pluck('users.id')->all(),
        );
    }

    public function test_assigning_somebody_starts_no_conversation_with_them(): void
    {
        // Messages is where a person raises something — that a job is bigger
        // than it looked, that they need more hours. A thread per assignment
        // buried those under traffic nobody wrote and nobody reads.
        [, $project] = $this->workspace();
        $assignee = User::factory()->create();

        $taskId = (int) $this->postJson('/api/tasks', [
            'project_id' => $project->id,
            'title' => 'Cut the launch reel',
            'assignee_user_ids' => [$assignee->id],
        ])->assertCreated()->json('data.id');

        $second = User::factory()->create();
        $this->patchJson("/api/tasks/{$taskId}", ['assignee_user_ids' => [$second->id]])->assertOk();

        $this->assertDatabaseCount('task_notes', 0);
    }

    public function test_workspace_scoped_validation_rejects_a_foreign_workspace_user(): void
    {
        [, $project] = $this->workspace();
        $task = Task::query()->create([
            'project_id' => $project->id,
            'title' => 'Cross-workspace assignment attempt',
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);

        // withoutAutomaticWorkspace: a plain factory create() here would
        // auto-join the seeded default workspace (the fallback for "no
        // current workspace"), defeating the point of a foreign-workspace
        // user. This mirrors the same pattern real onboarding uses.
        $foreignOwner = User::withoutAutomaticWorkspace(fn () => User::factory()->create(['role_id' => null]));
        WorkspaceProvisioner::provision($foreignOwner, 'Other Tenant');
        // $foreignOwner now belongs only to the new workspace, not the one
        // $this->admin (and the task) live in.

        $this->patchJson("/api/tasks/{$task->id}", [
            'assignee_user_id' => $foreignOwner->id,
        ])->assertStatus(422);

        $this->assertDatabaseMissing('task_assignees', ['task_id' => $task->id, 'user_id' => $foreignOwner->id]);
        $this->assertNull($task->fresh()->assignee_user_id);
    }

    public function test_tasks_assign_gate_applies_to_the_array_key_too(): void
    {
        [, $project] = $this->workspace();
        $task = Task::query()->create([
            'project_id' => $project->id,
            'title' => 'Gate check',
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);
        $target = User::factory()->create();

        $role = Role::query()->create(['name' => 'Editor only', 'key_name' => 'editor_only']);
        $role->permissions()->createMany([
            ['permission_key' => 'dashboard.view'],
            ['permission_key' => 'tasks.view'],
            ['permission_key' => 'tasks.edit'],
            ['permission_key' => 'time.track'],
        ]);
        $editor = User::factory()->create(['role_id' => $role->id]);
        Sanctum::actingAs($editor);

        $this->patchJson("/api/tasks/{$task->id}", [
            'assignee_user_ids' => [$target->id],
        ])->assertForbidden();

        $this->assertDatabaseMissing('task_assignees', ['task_id' => $task->id, 'user_id' => $target->id]);
    }

    public function test_mine_unassigned_and_none_filter_are_membership_aware_under_multi_assignment(): void
    {
        [, $project] = $this->workspace();
        // The assignees act as themselves here, so unlike the other cases in
        // this file they need a role that can actually read the queue.
        $role = Role::query()->create(['name' => 'Queue reader', 'key_name' => 'queue_reader']);
        $role->permissions()->createMany([
            ['permission_key' => 'dashboard.view'],
            ['permission_key' => 'tasks.view'],
            ['permission_key' => 'time.track'],
        ]);
        $first = User::factory()->create(['role_id' => $role->id]);
        $second = User::factory()->create(['role_id' => $role->id]);

        $multiAssigned = Task::query()->create([
            'project_id' => $project->id,
            'title' => 'Multi-assigned task',
            'status_value_id' => $this->statusId('pending'),
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);
        TaskAssigneeSync::apply($multiAssigned, [$first->id, $second->id]);

        $unassigned = Task::query()->create([
            'project_id' => $project->id,
            'title' => 'Genuinely unassigned task',
            'status_value_id' => $this->statusId('pending'),
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);

        Sanctum::actingAs($second);
        TimeSession::query()->create(['user_id' => $second->id, 'clock_in_at' => now()]);

        $this->getJson('/api/tasks?mine=1')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $multiAssigned->id);

        $this->getJson('/api/tasks?view=unassigned')
            ->assertOk()
            ->assertJsonPath('data.0.id', $unassigned->id)
            ->assertJsonCount(1, 'data');

        $this->getJson('/api/tasks?assignee_user_id=none')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $unassigned->id);

        $this->getJson('/api/tasks?assignee_user_id='.$first->id)
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $multiAssigned->id);
    }

    public function test_view_counts_do_not_inflate_for_a_task_with_several_assignees(): void
    {
        [, $project] = $this->workspace();
        $first = User::factory()->create();
        $second = User::factory()->create();
        $third = User::factory()->create();

        $task = Task::query()->create([
            'project_id' => $project->id,
            'title' => 'Triple-assigned task',
            'status_value_id' => $this->statusId('pending'),
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);
        TaskAssigneeSync::apply($task, [$first->id, $second->id, $third->id]);

        $response = $this->getJson('/api/tasks')->assertOk();

        $this->assertSame(1, $response->json('counts.all'));
        $this->assertSame(1, $response->json('meta.total'));
        $this->assertCount(1, $response->json('data'));
    }

    private function statusId(string $key): int
    {
        return (int) FieldValue::query()->where('key_name', $key)
            ->whereHas('field', fn ($field) => $field->where('key_name', 'task_status'))
            ->value('id');
    }

    private function workspace(): array
    {
        $client = Client::query()->create([
            'name' => 'Assignee test client',
            'created_by' => $this->admin->id,
        ]);
        $project = Project::query()->create([
            'client_id' => $client->id,
            'name' => 'Assignee test project',
            'created_by' => $this->admin->id,
        ]);

        return [$client, $project];
    }
}
