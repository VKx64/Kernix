<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use App\Support\CurrentWorkspace;
use App\Support\TaskStatuses;
use App\Support\WorkspaceProvisioner;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Clients and Projects: the two flags that had to hide a default row instead
 * of going nullable, because contacts.client_id, projects.client_id, and
 * tasks.project_id are NOT NULL foreign keys carrying tenancy. This suite is
 * backend-only on purpose — the toggle is not RENDERED yet, so the only way
 * in is a direct workspace write or a raw PATCH to the features endpoint.
 */
class WorkspaceClientsProjectsFeatureTest extends TestCase
{
    use RefreshDatabase;

    private function seedWorkspace(string $name): array
    {
        $owner = User::factory()->create();
        $workspace = WorkspaceProvisioner::provision($owner, $name);

        return [$workspace, $owner->fresh()];
    }

    public function test_creating_a_project_with_no_client_id_lands_on_the_hidden_general_client_when_clients_is_off(): void
    {
        [$workspace, $admin] = $this->seedWorkspace('Northwind');
        CurrentWorkspace::use($workspace->id, fn () => $workspace->update(['feature_clients_enabled' => false]));
        Sanctum::actingAs($admin);

        $this->getJson('/api/clients')->assertStatus(403)->assertJsonPath('code', 'FEATURE_DISABLED');

        $response = $this->postJson('/api/projects', ['name' => 'Launch'])->assertSuccessful();
        $projectId = $response->json('data.id');

        $defaultClient = CurrentWorkspace::use($workspace->id, fn () => Client::query()->where('is_default', true)->first());
        $this->assertNotNull($defaultClient);
        $this->assertSame('General', $defaultClient->name);
        $project = CurrentWorkspace::use($workspace->id, fn () => Project::withoutGlobalScope('workspace')->find($projectId));
        $this->assertSame($defaultClient->id, $project->client_id);
    }

    public function test_a_pre_existing_workspace_with_no_default_rows_yet_can_turn_clients_off_and_create_a_project_immediately(): void
    {
        [$workspace, $admin] = $this->seedWorkspace('Northwind');
        // Simulate a workspace that predates this change: no default client exists.
        $this->assertSame(0, Client::withoutGlobalScope('workspace')->where('workspace_id', $workspace->id)->count());
        CurrentWorkspace::use($workspace->id, fn () => $workspace->update(['feature_clients_enabled' => false]));
        Sanctum::actingAs($admin);

        $this->postJson('/api/projects', ['name' => 'Launch'])->assertSuccessful();
    }

    public function test_re_enabling_clients_shows_original_clients_with_projects_intact_and_reveals_a_used_default_client(): void
    {
        [$workspace, $admin] = $this->seedWorkspace('Northwind');
        $original = CurrentWorkspace::use($workspace->id, fn () => Client::query()->create(['name' => 'Acme', 'created_by' => $admin->id]));
        $originalProject = CurrentWorkspace::use($workspace->id, fn () => Project::query()->create(['client_id' => $original->id, 'name' => 'Existing', 'created_by' => $admin->id]));
        CurrentWorkspace::use($workspace->id, fn () => $workspace->update(['feature_clients_enabled' => false]));
        Sanctum::actingAs($admin);

        $this->postJson('/api/projects', ['name' => 'While off'])->assertSuccessful();

        $this->patchJson("/api/workspaces/{$workspace->id}/features", [
            'features' => ['clients' => true],
        ])->assertOk();

        $clients = $this->getJson('/api/clients')->assertOk()->json('data');
        $names = collect($clients)->pluck('name')->all();
        $this->assertContains('Acme', $names);
        $this->assertContains('General', $names, 'A default client that picked up real data must become visible.');

        $projectStillThere = CurrentWorkspace::use($workspace->id, fn () => Project::query()->whereKey($originalProject->id)->exists());
        $this->assertTrue($projectStillThere);
    }

    public function test_creating_a_task_with_no_project_id_lands_on_the_hidden_general_project_when_projects_is_off(): void
    {
        [$workspace, $admin] = $this->seedWorkspace('Northwind');
        TaskStatuses::flush();
        CurrentWorkspace::use($workspace->id, function () use ($admin) {
            \App\Models\TimeSession::query()->create(['user_id' => $admin->id, 'clock_in_at' => now()]);
        });
        $client = CurrentWorkspace::use($workspace->id, fn () => Client::query()->create(['name' => 'Acme', 'created_by' => $admin->id]));
        $existingProject = CurrentWorkspace::use($workspace->id, fn () => Project::query()->create(['client_id' => $client->id, 'name' => 'Existing', 'created_by' => $admin->id]));
        CurrentWorkspace::use($workspace->id, fn () => $workspace->update(['feature_projects_enabled' => false]));
        Sanctum::actingAs($admin);

        $this->getJson('/api/projects')->assertStatus(403)->assertJsonPath('code', 'FEATURE_DISABLED');
        $this->getJson("/api/projects/{$existingProject->id}/task-folders")->assertStatus(403)->assertJsonPath('code', 'FEATURE_DISABLED');

        $response = $this->postJson('/api/tasks', ['title' => 'Do the thing'])->assertSuccessful();
        $taskId = $response->json('data.id');

        $defaultProject = CurrentWorkspace::use($workspace->id, fn () => Project::query()->where('is_default', true)->first());
        $this->assertNotNull($defaultProject);
        $this->assertSame('General', $defaultProject->name);
        $task = CurrentWorkspace::use($workspace->id, fn () => Task::withoutGlobalScope('workspace')->find($taskId));
        $this->assertSame($defaultProject->id, $task->project_id);
    }

    public function test_re_enabling_projects_restores_every_project_with_its_tasks(): void
    {
        [$workspace, $admin] = $this->seedWorkspace('Northwind');
        TaskStatuses::flush();
        $client = CurrentWorkspace::use($workspace->id, fn () => Client::query()->create(['name' => 'Acme', 'created_by' => $admin->id]));
        $original = CurrentWorkspace::use($workspace->id, fn () => Project::query()->create(['client_id' => $client->id, 'name' => 'Existing', 'created_by' => $admin->id]));
        CurrentWorkspace::use($workspace->id, function () use ($admin) {
            \App\Models\TimeSession::query()->create(['user_id' => $admin->id, 'clock_in_at' => now()]);
        });
        CurrentWorkspace::use($workspace->id, fn () => $workspace->update(['feature_projects_enabled' => false]));
        Sanctum::actingAs($admin);

        $this->postJson('/api/tasks', ['title' => 'While off'])->assertSuccessful();

        $this->patchJson("/api/workspaces/{$workspace->id}/features", [
            'features' => ['projects' => true],
        ])->assertOk();

        $projects = $this->getJson('/api/projects')->assertOk()->json('data');
        $names = collect($projects)->pluck('name')->all();
        $this->assertContains('Existing', $names);
        $this->assertContains('General', $names, 'A default project that picked up real data must become visible.');

        $originalStillHasTasks = CurrentWorkspace::use($workspace->id, fn () => Project::query()->whereKey($original->id)->exists());
        $this->assertTrue($originalStillHasTasks);
    }

    public function test_preflight_blocks_disabling_clients_with_active_clients_then_force_succeeds_without_deleting_anything(): void
    {
        [$workspace, $admin] = $this->seedWorkspace('Northwind');
        $client = CurrentWorkspace::use($workspace->id, fn () => Client::query()->create(['name' => 'Acme', 'created_by' => $admin->id]));
        Sanctum::actingAs($admin);

        $before = Client::withoutGlobalScope('workspace')->count();

        $this->patchJson("/api/workspaces/{$workspace->id}/features", [
            'features' => ['clients' => false],
        ])->assertStatus(409)
            ->assertJsonPath('code', 'FEATURE_HAS_DEPENDENT_DATA')
            ->assertJsonPath('blockers.0.type', 'clients')
            ->assertJsonPath('blockers.0.count', 1);

        $this->assertTrue($workspace->fresh()->feature_clients_enabled, 'A blocked toggle must not have written anything.');

        $this->patchJson("/api/workspaces/{$workspace->id}/features", [
            'features' => ['clients' => false],
            'force' => true,
        ])->assertOk();

        $this->assertFalse($workspace->fresh()->feature_clients_enabled);
        $after = Client::withoutGlobalScope('workspace')->count();
        $this->assertSame($before, $after, 'force must not delete anything.');
        $stillThere = Client::withoutGlobalScope('workspace')->whereKey($client->id)->exists();
        $this->assertTrue($stillThere);
    }

    public function test_enabling_contacts_while_clients_is_off_is_rejected(): void
    {
        [$workspace, $admin] = $this->seedWorkspace('Northwind');
        CurrentWorkspace::use($workspace->id, fn () => $workspace->update(['feature_clients_enabled' => false, 'feature_contacts_enabled' => false]));
        Sanctum::actingAs($admin);

        $this->patchJson("/api/workspaces/{$workspace->id}/features", [
            'features' => ['contacts' => true],
        ])->assertStatus(422);

        $this->assertFalse($workspace->fresh()->feature_contacts_enabled);
    }

    public function test_force_disabling_clients_also_flips_contacts_off_in_the_same_write(): void
    {
        [$workspace, $admin] = $this->seedWorkspace('Northwind');
        $this->assertTrue($workspace->feature_contacts_enabled);
        Sanctum::actingAs($admin);

        $this->patchJson("/api/workspaces/{$workspace->id}/features", [
            'features' => ['clients' => false],
            'force' => true,
        ])->assertOk();

        $fresh = $workspace->fresh();
        $this->assertFalse($fresh->feature_clients_enabled);
        $this->assertFalse($fresh->feature_contacts_enabled, 'Contacts requires clients, so it must cascade off.');
    }

    public function test_the_settings_catalog_renders_clients_and_projects_switches(): void
    {
        [$workspace, $admin] = $this->seedWorkspace('Northwind');
        Sanctum::actingAs($admin);

        $keys = collect($this->getJson("/api/workspaces/{$workspace->id}/features")->assertOk()->json('data.features'))
            ->pluck('key')->all();

        $this->assertContains('clients', $keys);
        $this->assertContains('projects', $keys);
    }
}
