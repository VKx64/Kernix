<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Client;
use App\Models\Project;
use App\Models\Role;
use App\Models\Task;
use App\Models\TaskFolder;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class TaskFolderApiTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed();
        $this->admin = User::query()->findOrFail(1);
        Sanctum::actingAs($this->admin);
    }

    public function test_project_folders_are_nested_audited_and_do_not_require_clock_in(): void
    {
        [$firstProject, $secondProject] = $this->projects();

        $created = $this->postJson("/api/projects/{$firstProject->id}/task-folders", [
            'name' => 'Pre-production',
        ])->assertCreated()
            ->assertJsonPath('data.project_id', $firstProject->id)
            ->assertJsonPath('data.name', 'Pre-production')
            ->assertJsonPath('data.sort_order', 10);
        $folderId = $created->json('data.id');

        $this->getJson("/api/projects/{$firstProject->id}/task-folders")
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $folderId);

        $this->patchJson("/api/projects/{$firstProject->id}/task-folders/{$folderId}", [
            'name' => 'Production',
            'sort_order' => 20,
        ])->assertOk()
            ->assertJsonPath('data.name', 'Production')
            ->assertJsonPath('data.sort_order', 20);

        $this->patchJson("/api/projects/{$secondProject->id}/task-folders/{$folderId}", [
            'name' => 'Wrong project',
        ])->assertNotFound();

        $this->assertSame(1, AuditLog::query()->where('action', 'task_folder.create')->where('entity_id', $folderId)->count());
        $this->assertSame(1, AuditLog::query()->where('action', 'task_folder.update')->where('entity_id', $folderId)->count());
    }

    public function test_task_folder_assignment_must_match_the_task_project_and_project_moves_clear_it(): void
    {
        [$firstProject, $secondProject] = $this->projects();
        $firstFolder = TaskFolder::query()->create([
            'project_id' => $firstProject->id,
            'name' => 'First project folder',
            'created_by' => $this->admin->id,
        ]);
        $secondFolder = TaskFolder::query()->create([
            'project_id' => $secondProject->id,
            'name' => 'Second project folder',
            'created_by' => $this->admin->id,
        ]);
        $task = Task::query()->create([
            'project_id' => $firstProject->id,
            'task_folder_id' => $firstFolder->id,
            'title' => 'Folder-aware task',
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);

        $this->getJson("/api/tasks?task_folder_id={$firstFolder->id}")
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.id', $task->id)
            ->assertJsonPath('data.0.folder.id', $firstFolder->id);
        $this->getJson("/api/tasks/{$task->id}")
            ->assertOk()
            ->assertJsonPath('data.folder.id', $firstFolder->id);

        $this->patchJson("/api/tasks/{$task->id}", [
            'task_folder_id' => $secondFolder->id,
            'admin_override' => true,
        ])->assertUnprocessable()
            ->assertJsonValidationErrors('task_folder_id');
        $this->assertSame($firstFolder->id, $task->fresh()->task_folder_id);

        $this->postJson('/api/tasks', [
            'project_id' => $secondProject->id,
            'task_folder_id' => $firstFolder->id,
            'title' => 'Invalid cross-project folder',
            'admin_override' => true,
        ])->assertUnprocessable()
            ->assertJsonValidationErrors('task_folder_id');

        $this->patchJson("/api/tasks/{$task->id}", [
            'project_id' => $secondProject->id,
            'admin_override' => true,
        ])->assertOk()
            ->assertJsonPath('data.project_id', $secondProject->id)
            ->assertJsonPath('data.task_folder_id', null)
            ->assertJsonPath('data.folder', null);

        $this->assertDatabaseHas('tasks', [
            'id' => $task->id,
            'project_id' => $secondProject->id,
            'task_folder_id' => null,
        ]);
    }

    public function test_deleting_a_folder_ungroups_its_tasks_without_deleting_them(): void
    {
        [$project] = $this->projects();
        $folder = TaskFolder::query()->create([
            'project_id' => $project->id,
            'name' => 'Temporary folder',
            'created_by' => $this->admin->id,
        ]);
        $task = Task::query()->create([
            'project_id' => $project->id,
            'task_folder_id' => $folder->id,
            'title' => 'Keep this task',
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);

        $this->deleteJson("/api/projects/{$project->id}/task-folders/{$folder->id}")
            ->assertStatus(409)
            ->assertJsonPath('code', 'CLOCK_IN_REQUIRED');

        $this->deleteJson("/api/projects/{$project->id}/task-folders/{$folder->id}", [
            'admin_override' => true,
        ])
            ->assertNoContent();

        $this->assertDatabaseMissing('task_folders', ['id' => $folder->id]);
        $this->assertDatabaseHas('tasks', [
            'id' => $task->id,
            'task_folder_id' => null,
            'deleted_at' => null,
        ]);
        $this->assertSame(1, AuditLog::query()->where('action', 'task_folder.delete')->where('entity_id', $folder->id)->count());
    }

    public function test_folder_read_and_write_permissions_are_kept_separate(): void
    {
        [$project] = $this->projects();
        $viewerRole = Role::query()->create(['name' => 'Task folder viewer', 'key_name' => 'task_folder_viewer']);
        $viewerRole->permissions()->createMany([
            ['permission_key' => 'dashboard.view'],
            ['permission_key' => 'tasks.view'],
        ]);
        $viewer = User::factory()->create(['role_id' => $viewerRole->id]);
        Sanctum::actingAs($viewer);

        $this->getJson("/api/projects/{$project->id}/task-folders")->assertOk();
        $this->postJson("/api/projects/{$project->id}/task-folders", ['name' => 'Forbidden'])
            ->assertForbidden();

        $editorRole = Role::query()->create(['name' => 'Project folder editor', 'key_name' => 'project_folder_editor']);
        $editorRole->permissions()->createMany([
            ['permission_key' => 'dashboard.view'],
            ['permission_key' => 'projects.view'],
            ['permission_key' => 'projects.edit'],
        ]);
        $editor = User::factory()->create(['role_id' => $editorRole->id]);
        Sanctum::actingAs($editor);

        $folderId = $this->postJson("/api/projects/{$project->id}/task-folders", ['name' => 'Editable'])
            ->assertCreated()
            ->json('data.id');
        Task::query()->create([
            'project_id' => $project->id,
            'task_folder_id' => $folderId,
            'title' => 'Protected grouped task',
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);
        $this->deleteJson("/api/projects/{$project->id}/task-folders/{$folderId}")
            ->assertForbidden();

        $trashedFolderId = $this->postJson("/api/projects/{$project->id}/task-folders", ['name' => 'Still protected'])
            ->assertCreated()
            ->json('data.id');
        $trashedTask = Task::query()->create([
            'project_id' => $project->id,
            'task_folder_id' => $trashedFolderId,
            'title' => 'Soft-deleted grouped task',
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);
        $trashedTask->delete();
        $this->deleteJson("/api/projects/{$project->id}/task-folders/{$trashedFolderId}")
            ->assertForbidden();
        $this->assertDatabaseHas('task_folders', ['id' => $trashedFolderId]);

        $this->getJson("/api/projects/{$project->id}/task-folders")->assertForbidden();
    }

    /** @return array{Project, Project} */
    private function projects(): array
    {
        $client = Client::query()->create([
            'name' => 'Folder client',
            'created_by' => $this->admin->id,
        ]);

        return [
            Project::query()->create([
                'client_id' => $client->id,
                'name' => 'First folder project',
                'created_by' => $this->admin->id,
            ]),
            Project::query()->create([
                'client_id' => $client->id,
                'name' => 'Second folder project',
                'created_by' => $this->admin->id,
            ]),
        ];
    }
}
