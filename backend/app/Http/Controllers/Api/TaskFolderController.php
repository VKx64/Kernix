<?php

namespace App\Http\Controllers\Api;

use App\Models\Project;
use App\Models\TaskFolder;
use App\Support\SingleClient;
use App\Support\TaskMutationGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class TaskFolderController extends ApiController
{
    public function index(Request $request, Project $project): JsonResponse
    {
        $this->permission($request, 'tasks.view');
        $this->withinClient($project);

        return $this->data($project->taskFolders()
            ->orderBy('sort_order')
            ->orderBy('name')
            ->orderBy('id')
            ->get());
    }

    public function store(Request $request, Project $project): JsonResponse
    {
        $this->permission($request, 'projects.edit');
        $this->withinClient($project);
        $data = $this->validated($request, $project);
        $data['sort_order'] ??= ((int) $project->taskFolders()->max('sort_order')) + 10;
        $folder = $project->taskFolders()->create($data + ['created_by' => $request->user()->id]);
        $this->audit($request, 'task_folder.create', $folder, $folder->toArray());

        return $this->data($folder, 201);
    }

    public function update(Request $request, Project $project, TaskFolder $taskFolder): JsonResponse
    {
        $this->permission($request, 'projects.edit');
        $this->withinClient($project);
        $before = $taskFolder->getAttributes();
        $taskFolder->update($this->validated($request, $project, $taskFolder, true));
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
        [$before, $ungrouped] = DB::transaction(function () use ($request, $project, $taskFolder): array {
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
            $count = $lockedFolder->tasks()->withTrashed()->update(['task_folder_id' => null]);
            $lockedFolder->delete();

            return [$before, $count];
        });
        $this->audit($request, 'task_folder.delete', $taskFolder, [
            'before' => $before,
            'ungrouped_task_count' => $ungrouped,
        ]);

        return response()->json(null, 204);
    }

    private function validated(Request $request, Project $project, ?TaskFolder $taskFolder = null, bool $partial = false): array
    {
        return $request->validate([
            'name' => [
                $partial ? 'sometimes' : 'required',
                'string',
                'max:191',
                Rule::unique('task_folders', 'name')
                    ->where(fn ($query) => $query->where('project_id', $project->id))
                    ->ignore($taskFolder?->id),
            ],
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
