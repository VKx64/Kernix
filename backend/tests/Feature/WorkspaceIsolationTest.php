<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Project;
use App\Models\Role;
use App\Models\Task;
use App\Models\User;
use App\Models\Workspace;
use App\Support\CurrentWorkspace;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class WorkspaceIsolationTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        CurrentWorkspace::reset();
        $this->seed();
        $this->admin = User::query()->findOrFail(1);
        Sanctum::actingAs($this->admin);
    }

    public function test_a_new_account_lands_in_a_workspace_and_can_list_it(): void
    {
        $this->assertGreaterThan(0, $this->admin->workspaces()->count());

        $this->getJson('/api/workspaces')
            ->assertOk()
            ->assertJsonPath('data.0.active', true);
    }

    public function test_data_created_in_one_workspace_is_invisible_from_another(): void
    {
        $first = $this->makeClientProjectTask('Acme', 'Launch', 'Book the studio');

        $created = $this->postJson('/api/workspaces', ['name' => 'Second studio'])
            ->assertCreated()
            ->assertJsonPath('data.name', 'Second studio');
        $secondId = $created->json('data.id');

        // The switch already happened, so the first workspace's work is gone.
        $this->getJson('/api/tasks')->assertOk()->assertJsonPath('meta.total', 0);
        $this->getJson('/api/clients')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/projects')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson("/api/tasks/{$first['task']->id}")->assertNotFound();

        $second = $this->makeClientProjectTask('Globex', 'Rebrand', 'Draft the rebrand deck');
        $this->getJson('/api/tasks')->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.title', 'Draft the rebrand deck');
        $this->assertSame($secondId, $second['task']->workspace_id);

        // Switching back restores exactly the first workspace's data.
        $this->postJson("/api/workspaces/{$first['workspace']}/activate")->assertOk()->assertJsonPath('data.active', true);
        $this->getJson('/api/tasks')->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.title', 'Book the studio');
        $this->getJson("/api/tasks/{$second['task']->id}")->assertNotFound();
    }

    public function test_a_member_cannot_activate_a_workspace_they_do_not_belong_to(): void
    {
        $outsider = Workspace::query()->create(['name' => 'Private', 'slug' => 'private', 'created_by' => $this->admin->id]);
        $employee = User::factory()->create(['role_id' => Role::query()->create(['name' => 'Member', 'key_name' => 'member_role'])->id]);
        $employee->workspaces()->detach($outsider->id);
        Sanctum::actingAs($employee->fresh());

        $this->postJson("/api/workspaces/{$outsider->id}/activate")->assertForbidden();
    }

    public function test_creating_a_workspace_needs_the_permission(): void
    {
        $employee = User::factory()->create(['role_id' => Role::query()->create(['name' => 'Viewer', 'key_name' => 'viewer_role'])->id]);
        Sanctum::actingAs($employee->fresh());

        $this->postJson('/api/workspaces', ['name' => 'Nope'])->assertForbidden();
    }

    /**
     * @return array{workspace: int, task: Task}
     */
    private function makeClientProjectTask(string $clientName, string $projectName, string $taskTitle): array
    {
        $client = Client::query()->create(['name' => $clientName, 'created_by' => $this->admin->id]);
        $project = Project::query()->create([
            'client_id' => $client->id,
            'name' => $projectName,
            'created_by' => $this->admin->id,
        ]);
        $task = Task::query()->create([
            'project_id' => $project->id,
            'title' => $taskTitle,
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);

        return ['workspace' => (int) $task->workspace_id, 'task' => $task];
    }
}
