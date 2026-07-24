<?php

namespace App\Services;

use App\Models\SystemSetting;
use App\Models\TaskEstimateRequest;

class AiEstimateInactivityService
{
    public function __construct(private readonly TaskEstimateDecisionService $decisions) {}

    public function rejectInactive(): int
    {
        $hours = max(1, (int) SystemSetting::query()->value('ai_inactivity_hours'));
        $count = 0;
        TaskEstimateRequest::query()
            ->where('review_mode', 'ai')
            ->where('status', 'pending')
            ->where('ai_state', 'waiting_employee')
            ->where('awaiting_employee_since', '<=', now()->subHours($hours))
            ->whereHas('task', fn ($task) => $task->whereNull('archived_at')->whereHas(
                'project', fn ($project) => $project->where('ai_estimate_review_enabled', true)
            ))
            ->orderBy('id')
            ->eachById(function (TaskEstimateRequest $request) use (&$count, $hours): void {
                $this->decisions->decide(
                    $request->id,
                    'reject',
                    null,
                    "This request was automatically rejected because the AI project manager's questions were unanswered for {$hours} hours.",
                    'system',
                );
                $count++;
            });

        return $count;
    }
}
