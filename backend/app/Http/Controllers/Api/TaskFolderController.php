<?php

namespace App\Http\Controllers\Api;

use App\Models\Project;
use App\Models\TaskFolder;
use App\Support\SingleClient;
use App\Support\TaskMutationGuard;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class TaskFolderController extends ApiController
{
    public function index(Request $request, Project $project): JsonResponse
    {
        $this->permission($request, 'tasks.view');
        $this->withinClient($project);

        // Flat, but in tree order: a parent always precedes its children, so a
        // client can render the list as-is or nest it without a second sort.
        $folders = $project->taskFolders()
            ->orderBy('sort_order')
            ->orderBy('name')
            ->orderBy('id')
            ->get();

        return $this->data($this->inTreeOrder($folders));
    }

    public function store(Request $request, Project $project): JsonResponse
    {
        $this->permission($request, 'projects.edit');
        $this->withinClient($project);
        $data = $this->validated($request, $project);
        $parent = $this->parentFolder($project, $data['parent_id'] ?? null);
        if ($parent && $parent->depth() >= TaskFolder::MAX_DEPTH) {
            $this->rejectDepth();
        }
        $data['parent_id'] = $parent?->id;
        $data['sort_order'] ??= ((int) $project->taskFolders()
            ->where('parent_id', $parent?->id)
            ->max('sort_order')) + 10;

        $folder = $project->taskFolders()->create($data + ['created_by' => $request->user()->id]);
        $this->audit($request, 'task_folder.create', $folder, $folder->toArray());

        return $this->data($folder, 201);
    }

    public function update(Request $request, Project $project, TaskFolder $taskFolder): JsonResponse
    {
        $this->permission($request, 'projects.edit');
        $this->withinClient($project);
        $data = $this->validated($request, $project, $taskFolder, true);
        $before = $taskFolder->getAttributes();

        if (array_key_exists('parent_id', $data)) {
            $parent = $this->parentFolder($project, $data['parent_id']);
            $this->assertMovable($project, $taskFolder, $parent);
            $data['parent_id'] = $parent?->id;
        }

        $taskFolder->update($data);
        $this->audit($request, 'task_folder.update', $taskFolder, [
            'before' => $before,
            'after' => $taskFolder->getAttributes(),
        ]);

        return $this->data($taskFolder);
    }

    public function destroy(Request $request, Project $project, TaskFolder $taskFolder): JsonResponse
    {
        $this->permission($request, 'projects.edit');
        $this->withinClient($project);
        [$before, $ungrouped, $promoted] = DB::transaction(function () use ($request, $project, $taskFolder): array {
            $lockedFolder = TaskFolder::query()
                ->whereKey($taskFolder->id)
                ->where('project_id', $project->id)
                ->lockForUpdate()
                ->firstOrFail();

            if ($lockedFolder->tasks()->withTrashed()->exists()) {
                $this->permission($request, 'tasks.edit');
                TaskMutationGuard::enforce($request);
            }

            $before = $lockedFolder->getAttributes();
            // Children move up to where their parent sat instead of being
            // deleted with it, so removing a folder never takes work out of
            // sight that the person did not ask to remove.
            $promoted = $this->promoteChildren($project, $lockedFolder);
            $count = $lockedFolder->tasks()->withTrashed()->update(['task_folder_id' => null]);
            $lockedFolder->delete();

            return [$before, $count, $promoted];
        });
        $this->audit($request, 'task_folder.delete', $taskFolder, [
            'before' => $before,
            'ungrouped_task_count' => $ungrouped,
            'promoted_folder_ids' => $promoted,
        ]);

        return response()->json(null, 204);
    }

    /**
     * Re-home a deleted folder's children on its own parent.
     *
     * A promoted child can collide with a name already taken at the level it
     * lands on. Renaming it keeps the delete working rather than failing on a
     * constraint the person has no way to see coming.
     *
     * @return array<int, int>
     */
    private function promoteChildren(Project $project, TaskFolder $folder): array
    {
        $children = TaskFolder::query()
            ->where('project_id', $project->id)
            ->where('parent_id', $folder->id)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get();
        if ($children->isEmpty()) {
            return [];
        }

        $taken = TaskFolder::query()
            ->where('project_id', $project->id)
            ->where('parent_id', $folder->parent_id)
            ->whereKeyNot($folder->id)
            ->pluck('name')
            ->map(fn (string $name): string => mb_strtolower($name))
            ->all();

        $promoted = [];
        foreach ($children as $child) {
            $name = $this->availableName($child->name, $taken);
            $taken[] = mb_strtolower($name);
            $child->update(['parent_id' => $folder->parent_id, 'name' => $name]);
            $promoted[] = (int) $child->id;
        }

        return $promoted;
    }

    /** @param  array<int, string>  $taken */
    private function availableName(string $name, array $taken): string
    {
        if (! in_array(mb_strtolower($name), $taken, true)) {
            return $name;
        }
        for ($suffix = 2; $suffix < 1000; $suffix++) {
            $candidate = mb_substr($name, 0, 185).' ('.$suffix.')';
            if (! in_array(mb_strtolower($candidate), $taken, true)) {
                return $candidate;
            }
        }

        return mb_substr($name, 0, 180).' ('.uniqid().')';
    }

    /**
     * Guard a move: a folder cannot sit inside itself or its own subtree, and
     * the branch it carries has to still fit under the new parent.
     */
    private function assertMovable(Project $project, TaskFolder $folder, ?TaskFolder $parent): void
    {
        if (! $parent) {
            return;
        }
        $pool = TaskFolder::query()->where('project_id', $project->id)->get();
        if ((int) $parent->id === (int) $folder->id || in_array((int) $parent->id, $folder->descendantIds($pool), true)) {
            throw ValidationException::withMessages([
                'parent_id' => ['A folder cannot be moved inside itself.'],
            ]);
        }
        if ($parent->depth($pool) + $folder->subtreeHeight($pool) > TaskFolder::MAX_DEPTH) {
            $this->rejectDepth();
        }
    }

    private function rejectDepth(): void
    {
        throw ValidationException::withMessages([
            'parent_id' => ['Folders can only be nested '.TaskFolder::MAX_DEPTH.' levels deep.'],
        ]);
    }

    private function parentFolder(Project $project, mixed $parentId): ?TaskFolder
    {
        if ($parentId === null || $parentId === '') {
            return null;
        }
        $parent = TaskFolder::query()
            ->whereKey($parentId)
            ->where('project_id', $project->id)
            ->first();
        if (! $parent) {
            throw ValidationException::withMessages([
                'parent_id' => ['The chosen parent folder is not part of this project.'],
            ]);
        }

        return $parent;
    }

    /**
     * Parents before children, each level kept in the order it was queried in.
     *
     * @param  Collection<int, TaskFolder>  $folders
     * @return array<int, TaskFolder>
     */
    private function inTreeOrder(Collection $folders): array
    {
        $byParent = $folders->groupBy(fn (TaskFolder $folder): string => (string) ($folder->parent_id ?? ''));
        $ordered = [];
        $seen = [];
        $walk = function (string $parentKey) use (&$walk, $byParent, &$ordered, &$seen): void {
            foreach ($byParent->get($parentKey, collect()) as $folder) {
                if (isset($seen[$folder->id])) {
                    continue;
                }
                $seen[$folder->id] = true;
                $ordered[] = $folder;
                $walk((string) $folder->id);
            }
        };
        $walk('');

        // A folder orphaned by a parent removed outside the app still has to
        // appear, or it would be invisible and unfixable from the UI.
        foreach ($folders as $folder) {
            if (! isset($seen[$folder->id])) {
                $seen[$folder->id] = true;
                $ordered[] = $folder;
            }
        }

        return $ordered;
    }

    private function validated(Request $request, Project $project, ?TaskFolder $taskFolder = null, bool $partial = false): array
    {
        $parentId = $request->input('parent_id', $partial ? $taskFolder?->parent_id : null);
        $parentId = ($parentId === '' || $parentId === null) ? null : $parentId;

        return $request->validate([
            'name' => [
                $partial ? 'sometimes' : 'required',
                'string',
                'max:191',
                // Scoped to siblings so the same name may be reused under a
                // different parent. Top-level folders are only covered here:
                // a unique index treats their NULL parents as distinct.
                Rule::unique('task_folders', 'name')
                    ->where(fn ($query) => $query
                        ->where('project_id', $project->id)
                        ->where(fn ($scope) => $parentId === null
                            ? $scope->whereNull('parent_id')
                            : $scope->where('parent_id', $parentId)))
                    ->ignore($taskFolder?->id),
            ],
            'parent_id' => ['sometimes', 'nullable', 'integer'],
            'sort_order' => ['sometimes', 'integer', 'min:0', 'max:1000000'],
        ]);
    }

    private function withinClient(Project $project): void
    {
        if (SingleClient::enabled()) {
            abort_unless((int) $project->client_id === (int) SingleClient::id(), 404);
        }
    }
}
