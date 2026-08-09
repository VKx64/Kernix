<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskNote;
use App\Models\TimeSession;
use App\Models\User;
use App\Support\CurrentWorkspace;
use App\Support\TaskStatuses;
use App\Support\WorkspaceProvisioner;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Per-workspace feature toggles: enforcement of the four flags that ship this
 * pass, and the toggle API's preflight/force behaviour.
 */
class WorkspaceFeatureToggleTest extends TestCase
{
    use RefreshDatabase;

    private function seedWorkspace(string $name): array
    {
        $owner = User::factory()->create();
        $workspace = WorkspaceProvisioner::provision($owner, $name);

        return [$workspace, $owner->fresh()];
    }

    public function test_migrating_leaves_every_pre_existing_workspace_all_true(): void
    {
        $this->seed(\Database\Seeders\DatabaseSeeder::class);

        $workspace = \App\Models\Workspace::query()->firstOrFail();

        $this->assertTrue($workspace->feature_contacts_enabled);
        $this->assertTrue($workspace->feature_clients_enabled);
        $this->assertTrue($workspace->feature_projects_enabled);
        $this->assertTrue($workspace->feature_oliver_enabled);
        $this->assertTrue($workspace->feature_timesheet_enabled);
        $this->assertTrue($workspace->feature_messages_enabled);
    }

    public function test_provisioning_a_workspace_yields_all_true_features(): void
    {
        [$workspace] = $this->seedWorkspace('Northwind');

        $this->assertTrue($workspace->feature_contacts_enabled);
        $this->assertTrue($workspace->feature_timesheet_enabled);
        $this->assertTrue($workspace->feature_messages_enabled);
        $this->assertTrue($workspace->feature_oliver_enabled);
    }

    public function test_contacts_disabled_403s_an_admin_not_a_permission_gap(): void
    {
        [$workspace, $admin] = $this->seedWorkspace('Northwind');
        CurrentWorkspace::use($workspace->id, fn () => $workspace->update(['feature_contacts_enabled' => false]));
        Sanctum::actingAs($admin);

        $this->getJson('/api/contacts')->assertStatus(403)->assertJsonPath('code', 'FEATURE_DISABLED');
    }

    public function test_timesheet_disabled_403s_the_report_but_clock_in_still_works(): void
    {
        [$workspace, $admin] = $this->seedWorkspace('Northwind');
        CurrentWorkspace::use($workspace->id, fn () => $workspace->update(['feature_timesheet_enabled' => false]));
        Sanctum::actingAs($admin);

        $this->getJson('/api/timesheet')->assertStatus(403)->assertJsonPath('code', 'FEATURE_DISABLED');

        // THIS ASSERTION IS THE POINT OF THE WHOLE STAGE.
        $this->postJson('/api/time/clock-in')->assertSuccessful();
    }

    public function test_messages_disabled_still_allows_a_task_note(): void
    {
        [$workspace, $admin] = $this->seedWorkspace('Northwind');
        TaskStatuses::flush();
        CurrentWorkspace::use($workspace->id, function () use ($admin) {
            TimeSession::query()->create(['user_id' => $admin->id, 'clock_in_at' => now()]);
        });
        $client = CurrentWorkspace::use($workspace->id, fn () => Client::query()->create(['name' => 'Acme', 'created_by' => $admin->id]));
        $project = CurrentWorkspace::use($workspace->id, fn () => Project::query()->create(['client_id' => $client->id, 'name' => 'Launch', 'created_by' => $admin->id]));
        $task = CurrentWorkspace::use($workspace->id, fn () => Task::query()->create([
            'project_id' => $project->id,
            'title' => 'Do the thing',
            'status_value_id' => TaskStatuses::id('in_progress'),
            'assignee_user_id' => $admin->id,
            'created_by' => $admin->id,
        ]));
        CurrentWorkspace::use($workspace->id, fn () => $workspace->update(['feature_messages_enabled' => false]));
        Sanctum::actingAs($admin);

        $this->getJson('/api/messages')->assertStatus(403)->assertJsonPath('code', 'FEATURE_DISABLED');

        $this->postJson("/api/tasks/{$task->id}/notes", ['body' => 'A plain task note.'])
            ->assertSuccessful();

        $this->assertDatabaseHas('task_notes', ['task_id' => $task->id, 'body' => 'A plain task note.', 'is_message' => false]);
    }

    public function test_oliver_disabled_403s_all_six_routes(): void
    {
        [$workspace, $admin] = $this->seedWorkspace('Northwind');
        $action = CurrentWorkspace::use($workspace->id, fn () => \App\Models\OliverAction::query()->create([
            'user_id' => $admin->id,
            'type' => 'task.update',
            'summary' => 'did a thing',
            'entity_type' => 'Task',
            'entity_id' => 1,
            'before' => [],
            'after' => [],
        ]));
        CurrentWorkspace::use($workspace->id, fn () => $workspace->update(['feature_oliver_enabled' => false]));
        Sanctum::actingAs($admin);

        $this->getJson('/api/oliver')->assertStatus(403)->assertJsonPath('code', 'FEATURE_DISABLED');
        $this->postJson('/api/oliver/messages', ['body' => 'hi'])->assertStatus(403)->assertJsonPath('code', 'FEATURE_DISABLED');
        $this->deleteJson('/api/oliver/messages')->assertStatus(403)->assertJsonPath('code', 'FEATURE_DISABLED');
        $this->getJson('/api/oliver/insights')->assertStatus(403)->assertJsonPath('code', 'FEATURE_DISABLED');
        $this->getJson('/api/oliver/actions')->assertStatus(403)->assertJsonPath('code', 'FEATURE_DISABLED');
        $this->postJson("/api/oliver/actions/{$action->id}/undo")->assertStatus(403)->assertJsonPath('code', 'FEATURE_DISABLED');
    }

    public function test_console_schedule_has_no_oliver_entry(): void
    {
        $schedule = app(\Illuminate\Console\Scheduling\Schedule::class);
        $descriptions = collect($schedule->events())->map(fn ($event) => $event->description ?? '')->all();

        $this->assertNotContains('oliver', array_map('strtolower', $descriptions));
        foreach ($descriptions as $description) {
            $this->assertStringNotContainsStringIgnoringCase('oliver', $description);
        }
    }

    public function test_an_empty_workspace_toggles_contacts_off_in_one_request(): void
    {
        [$workspace, $admin] = $this->seedWorkspace('Northwind');
        Sanctum::actingAs($admin);

        $this->patchJson("/api/workspaces/{$workspace->id}/features", [
            'features' => ['contacts' => false],
        ])->assertOk()
            ->assertJsonPath('data.features.0.key', 'contacts')
            ->assertJsonPath('data.features.0.enabled', false);
    }

    public function test_dependent_message_threads_block_disabling_until_forced(): void
    {
        [$workspace, $admin] = $this->seedWorkspace('Northwind');
        TaskStatuses::flush();
        $client = CurrentWorkspace::use($workspace->id, fn () => Client::query()->create(['name' => 'Acme', 'created_by' => $admin->id]));
        $project = CurrentWorkspace::use($workspace->id, fn () => Project::query()->create(['client_id' => $client->id, 'name' => 'Launch', 'created_by' => $admin->id]));
        $task = CurrentWorkspace::use($workspace->id, fn () => Task::query()->create([
            'project_id' => $project->id,
            'title' => 'Do the thing',
            'status_value_id' => TaskStatuses::id('in_progress'),
            'assignee_user_id' => $admin->id,
            'created_by' => $admin->id,
        ]));
        $colleague = User::factory()->create();
        WorkspaceProvisioner::join($workspace, $colleague, null, false);
        $root = CurrentWorkspace::use($workspace->id, fn () => TaskNote::query()->create([
            'task_id' => $task->id,
            'is_message' => true,
            'body' => 'Starting a thread',
            'created_by' => $admin->id,
            'assigned_user_id' => $colleague->id,
        ]));
        CurrentWorkspace::use($workspace->id, fn () => $root->update(['conversation_id' => $root->id]));

        Sanctum::actingAs($admin);

        $response = $this->patchJson("/api/workspaces/{$workspace->id}/features", [
            'features' => ['messages' => false],
        ])->assertStatus(409)
            ->assertJsonPath('code', 'FEATURE_HAS_DEPENDENT_DATA')
            ->assertJsonPath('blockers.0.type', 'message_threads')
            ->assertJsonPath('blockers.0.count', 1);

        $this->assertTrue($workspace->fresh()->feature_messages_enabled, 'A blocked toggle must not have written anything.');

        $this->patchJson("/api/workspaces/{$workspace->id}/features", [
            'features' => ['messages' => false],
            'force' => true,
        ])->assertOk()
            ->assertJsonPath('data.features.2.key', 'messages')
            ->assertJsonPath('data.features.2.enabled', false);

        $this->assertFalse($workspace->fresh()->feature_messages_enabled);

        // force skips only the count check: the thread itself must survive.
        $survivingCount = \App\Models\TaskNote::withoutGlobalScope('workspace')->where('id', $root->id)->count();
        $this->assertSame(1, $survivingCount, 'force must not delete anything.');
    }

    public function test_active_workspace_differs_from_the_one_being_edited_and_counts_still_belong_to_the_target(): void
    {
        [$workspaceA, $admin] = $this->seedWorkspace('Northwind');
        [$workspaceB] = $this->seedWorkspace('Kestrel');
        WorkspaceProvisioner::join($workspaceB, $admin, WorkspaceProvisioner::adminRole($workspaceB), false);
        // Admin's active workspace stays A.
        $admin->forceFill(['active_workspace_id' => $workspaceA->id])->save();

        TaskStatuses::flush();
        $client = CurrentWorkspace::use($workspaceB->id, fn () => Client::query()->create(['name' => 'B client', 'created_by' => $admin->id]));
        $project = CurrentWorkspace::use($workspaceB->id, fn () => Project::query()->create(['client_id' => $client->id, 'name' => 'B project', 'created_by' => $admin->id]));
        $task = CurrentWorkspace::use($workspaceB->id, fn () => Task::query()->create([
            'project_id' => $project->id,
            'title' => 'B task',
            'status_value_id' => TaskStatuses::id('in_progress'),
            'assignee_user_id' => $admin->id,
            'created_by' => $admin->id,
        ]));
        $root = CurrentWorkspace::use($workspaceB->id, fn () => TaskNote::query()->create([
            'task_id' => $task->id,
            'is_message' => true,
            'body' => 'B thread',
            'created_by' => $admin->id,
            'assigned_user_id' => $admin->id,
        ]));
        CurrentWorkspace::use($workspaceB->id, fn () => $root->update(['conversation_id' => $root->id]));

        Sanctum::actingAs($admin->fresh());
        $this->assertSame($workspaceA->id, CurrentWorkspace::forUser($admin->fresh()));

        $this->patchJson("/api/workspaces/{$workspaceB->id}/features", [
            'features' => ['messages' => false],
        ])->assertStatus(409)
            ->assertJsonPath('blockers.0.count', 1);
    }

    public function test_a_non_member_gets_404_and_a_member_without_manage_gets_403(): void
    {
        [$workspace] = $this->seedWorkspace('Northwind');
        $stranger = User::factory()->create();
        Sanctum::actingAs($stranger);
        $this->getJson("/api/workspaces/{$workspace->id}/features")->assertStatus(404);

        $member = User::factory()->create();
        WorkspaceProvisioner::join($workspace, $member, null, false);
        Sanctum::actingAs($member);
        $this->getJson("/api/workspaces/{$workspace->id}/features")->assertStatus(403);
    }
}
