<?php

namespace App\Services;

use App\Models\Project;

class ProjectAiContext
{
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
