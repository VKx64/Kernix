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

    public function test_subfolders_nest_under_a_parent_and_reuse_names_across_branches(): void
    {
        [$project, $otherProject] = $this->projects();

        $design = $this->createFolder($project, 'Design');
        $build = $this->createFolder($project, 'Build');
        $designDrafts = $this->createFolder($project, 'Drafts', $design);
        // The same name under a different parent is a different folder, so it
        // has to be allowed even though the project already holds a "Drafts".
        $buildDrafts = $this->createFolder($project, 'Drafts', $build);
        $deepDraft = $this->createFolder($project, 'Rejected', $designDrafts);

        $this->assertDatabaseHas('task_folders', ['id' => $designDrafts, 'parent_id' => $design]);
        $this->assertDatabaseHas('task_folders', ['id' => $buildDrafts, 'parent_id' => $build]);

        // A sibling name is still taken.
        $this->postJson("/api/projects/{$project->id}/task-folders", [
            'name' => 'Drafts',
            'parent_id' => $design,
        ])->assertUnprocessable()->assertJsonValidationErrors('name');

        // Parents come before their children, so the list renders as a tree
        // without the client having to sort it again.
        $order = $this->getJson("/api/projects/{$project->id}/task-folders")
            ->assertOk()
            ->assertJsonCount(5, 'data')
            ->json('data.*.id');
        $this->assertSame([$design, $designDrafts, $deepDraft, $build, $buildDrafts], $order);

        $foreignFolder = $this->createFolder($otherProject, 'Elsewhere');
        $this->postJson("/api/projects/{$project->id}/task-folders", [
            'name' => 'Borrowed parent',
            'parent_id' => $foreignFolder,
        ])->assertUnprocessable()->assertJsonValidationErrors('parent_id');
    }

    public function test_nesting_is_capped_and_a_folder_cannot_be_moved_into_its_own_subtree(): void
    {
        [$project] = $this->projects();

        $parentId = null;
        $ids = [];
        for ($level = 1; $level <= TaskFolder::MAX_DEPTH; $level++) {
            $parentId = $this->createFolder($project, 'Level '.$level, $parentId);
            $ids[] = $parentId;
        }

        $this->postJson("/api/projects/{$project->id}/task-folders", [
            'name' => 'One too deep',
            'parent_id' => $ids[TaskFolder::MAX_DEPTH - 1],
        ])->assertUnprocessable()->assertJsonValidationErrors('parent_id');
        $this->assertDatabaseMissing('task_folders', ['name' => 'One too deep']);

        // Moving a branch counts the branch's own height, not just the new
        // parent's depth, or a tall subtree would slip past the cap. The whole
        // chain is MAX_DEPTH tall, so it no longer fits under anything.
        $shallow = $this->createFolder($project, 'Shallow');
        $this->patchJson("/api/projects/{$project->id}/task-folders/{$ids[0]}", [
            'parent_id' => $shallow,
        ])->assertUnprocessable()->assertJsonValidationErrors('parent_id');

        // One level shorter, so the same move at the same target is fine —
        // the cap is about the result, not about moving branches at all.
        $this->patchJson("/api/projects/{$project->id}/task-folders/{$ids[1]}", [
            'parent_id' => $shallow,
        ])->assertOk()->assertJsonPath('data.parent_id', $shallow);
        $this->patchJson("/api/projects/{$project->id}/task-folders/{$ids[1]}", [
            'parent_id' => $ids[0],
        ])->assertOk();

        $this->patchJson("/api/projects/{$project->id}/task-folders/{$ids[0]}", [
            'parent_id' => $ids[2],
        ])->assertUnprocessable()->assertJsonValidationErrors('parent_id');
        $this->patchJson("/api/projects/{$project->id}/task-folders/{$ids[0]}", [
            'parent_id' => $ids[0],
        ])->assertUnprocessable()->assertJsonValidationErrors('parent_id');
        $this->assertNull(TaskFolder::query()->findOrFail($ids[0])->parent_id);

        // Moving back to the top level is always allowed.
        $this->patchJson("/api/projects/{$project->id}/task-folders/{$ids[1]}", [
            'parent_id' => null,
        ])->assertOk()->assertJsonPath('data.parent_id', null);
    }

    public function test_deleting_a_folder_promotes_its_subfolders_instead_of_removing_them(): void
    {
        [$project] = $this->projects();
        $top = $this->createFolder($project, 'Phase one');
        $middle = $this->createFolder($project, 'Middle');
        $keptChild = $this->createFolder($project, 'Kept child', $middle);
        $grandchild = $this->createFolder($project, 'Grandchild', $keptChild);
        // Already taken at the level the child is about to land on.
        $this->createFolder($project, 'Kept child', $top);
        TaskFolder::query()->whereKey($middle)->update(['parent_id' => $top]);

        $task = Task::query()->create([
            'project_id' => $project->id,
            'task_folder_id' => $middle,
            'title' => 'Task in the removed folder',
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);

        $this->deleteJson("/api/projects/{$project->id}/task-folders/{$middle}", [
            'admin_override' => true,
        ])->assertNoContent();

        $this->assertDatabaseMissing('task_folders', ['id' => $middle]);
        // Promoted to where its parent sat, renamed around the name already
        // in use there, and its own children left hanging off it untouched.
        $promoted = TaskFolder::query()->findOrFail($keptChild);
        $this->assertSame($top, (int) $promoted->parent_id);
        $this->assertSame('Kept child (2)', $promoted->name);
        $this->assertSame($keptChild, (int) TaskFolder::query()->findOrFail($grandchild)->parent_id);
        $this->assertNull($task->fresh()->task_folder_id);
        $this->assertNull($task->fresh()->deleted_at);

        $audit = AuditLog::query()->where('action', 'task_folder.delete')->where('entity_id', $middle)->firstOrFail();
        $this->assertSame([$keptChild], $audit->changes_json['promoted_folder_ids']);
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

    private function createFolder(Project $project, string $name, ?int $parentId = null): int
    {
        return (int) $this->postJson("/api/projects/{$project->id}/task-folders", array_filter([
            'name' => $name,
            'parent_id' => $parentId,
        ], fn ($value): bool => $value !== null))
            ->assertCreated()
            ->json('data.id');
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
