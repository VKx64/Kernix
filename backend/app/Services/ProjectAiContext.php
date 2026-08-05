<?php

namespace App\Services;

use App\Models\Project;
use App\Models\Task;
use App\Models\TaskFolder;

class ProjectAiContext
{
    /**
     * Task creation additionally needs to see the shape of the project it is
     * adding to: who is on it, where tasks live, and what already exists, so it
     * stops proposing work the project already has.
     *
     * @return array<string, mixed>
     */
    public function forTaskCreation(Project $project): array
    {
        $project->loadMissing(['client', 'status', 'manager']);

        return $this->trusted($project) + [
            'client' => $project->client?->name,
            'project_status' => $project->status?->label,
            'project_manager' => $project->manager ? trim($project->manager->first_name.' '.$project->manager->last_name) : null,
            'task_folders' => TaskFolder::query()
                ->where('project_id', $project->id)
                ->orderBy('sort_order')->orderBy('id')
                ->get(['id', 'name'])
                ->toArray(),
            'existing_open_tasks' => $project->tasks()
                ->whereNull('archived_at')
                ->whereDoesntHave('status', fn ($query) => $query->where('key_name', 'complete'))
                ->with(['status:id,label', 'assignee:id,first_name,last_name', 'folder:id,name'])
                ->latest('id')->limit(40)->get()
                ->map(fn (Task $task) => [
                    'title' => $task->title,
                    'status' => $task->status?->label,
                    'folder' => $task->folder?->name,
                    'assignee' => $task->assignee ? trim($task->assignee->first_name.' '.$task->assignee->last_name) : null,
                    'due_date' => optional($task->due_date)->toDateString(),
                    'estimated_minutes' => (int) ($task->estimated_minutes ?? 0),
                ])->values()->all(),
            'recently_completed_tasks' => $project->tasks()
                ->whereHas('status', fn ($query) => $query->where('key_name', 'complete'))
                ->latest('updated_at')->limit(15)->pluck('title')->all(),
        ];
    }

    /** @return array<string, mixed> */
    public function trusted(Project $project): array
    {
        $profile = $project->aiProfile()->first();

        return [
            'project' => [
                'id' => $project->id,
                'name' => $project->name,
                'description' => $project->description,
                'start_date' => optional($project->start_date)->toDateString(),
                'due_date' => optional($project->due_date)->toDateString(),
            ],
            'approved_brief' => $profile?->brief_status === 'approved' ? $profile->approved_brief : null,
            'approved_memory' => $project->memoryEntries()->where('status', 'approved')->orderByDesc('importance')->orderBy('id')->limit(100)->get(['category', 'content', 'evidence'])->toArray(),
        ];
    }
}
