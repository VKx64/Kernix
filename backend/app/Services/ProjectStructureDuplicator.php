<?php

namespace App\Services;

use App\Models\FieldValue;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskFolder;

/** Copies only planning content, never work history, files or AI settings. Call inside a transaction. */
class ProjectStructureDuplicator
{
    public function copy(Project $source, Project $target, ?TaskFolder $root, string $name, bool $withTasks, int $actor): Project|TaskFolder
    {
        $pool = $source->taskFolders()->whereNull('archived_at')->get();
        $allowed = $root ? [$root->id, ...$root->descendantIds($pool)] : $pool->modelKeys();
        $folders = $pool->whereIn('id', $allowed)->sortBy(fn (TaskFolder $folder) => $folder->depth($pool));
        $map = [];
        $copiedRoot = null;
        foreach ($folders as $folder) {
            $isRoot = $root && $folder->id === $root->id;
            $copy = $target->taskFolders()->create([
                'name' => $isRoot ? $name : $folder->name,
                'parent_id' => $isRoot ? $root->parent_id : ($map[$folder->parent_id] ?? null),
                'sort_order' => $folder->sort_order,
                'created_by' => $actor,
            ]);
            $map[$folder->id] = $copy->id;
            if ($isRoot) {
                $copiedRoot = $copy;
            }
        }
        if ($withTasks) {
            $tasks = $source->tasks()->whereNull('archived_at')
                ->where(function ($query) use ($root, $allowed) {
                    $query->whereIn('task_folder_id', $allowed);
                    if (! $root) {
                        $query->orWhereNull('task_folder_id');
                    }
                })->with('subtasks')->get();
            $pending = FieldValue::query()->where('key_name', 'pending')
                ->whereHas('field', fn ($query) => $query->where('key_name', 'task_status'))->value('id');
            foreach ($tasks as $task) {
                $copy = Task::create([
                    'project_id' => $target->id,
                    'task_folder_id' => $map[$task->task_folder_id] ?? null,
                    'title' => $task->title,
                    'description' => $task->description,
                    'type_value_id' => $task->type_value_id,
                    'urgency_value_id' => $task->urgency_value_id,
                    'status_value_id' => $pending,
                    'actual_minutes' => 0,
                    'created_by' => $actor,
                ]);
                foreach ($task->subtasks as $step) {
                    $copy->subtasks()->create(['title' => $step->title, 'sort_order' => $step->sort_order ?? 0]);
                }
            }
        }

        return $copiedRoot ?? $target;
    }
}
