<?php

namespace App\Services;

use App\Jobs\ReviewTaskEstimateRequest;
use App\Models\AiReviewRun;
use App\Models\SystemSetting;
use App\Models\TaskEstimateRequest;
use App\Models\TaskNote;
use App\Support\AiFeatures;
use Illuminate\Support\Facades\DB;

class AiEstimateReviewCoordinator
{
    public function queue(TaskEstimateRequest $request, TaskNote $trigger): ?AiReviewRun
    {
        $request->loadMissing('task.project');
        if (
            $request->status !== 'pending'
            || $request->review_mode !== 'ai'
            || ! $request->task->project->ai_estimate_review_enabled
            || $request->task->archived_at !== null
            // The workspace switch is the outer gate over the project setting.
            || ! AiFeatures::enabled(SystemSetting::firstOrFail(), AiFeatures::ESTIMATE_REVIEW)
        ) {
            return null;
        }

        return DB::transaction(function () use ($request, $trigger): AiReviewRun {
            $settings = SystemSetting::firstOrFail();
            $run = AiReviewRun::firstOrCreate(
                ['trigger_note_id' => $trigger->id],
                [
                    'task_estimate_request_id' => $request->id,
                    'status' => 'queued',
                    'requested_model' => $settings->openrouter_model,
                    'prompt_version' => AiEstimateReviewPrompt::VERSION,
                ]
            );
            if ($run->wasRecentlyCreated) {
                $request->update([
                    'latest_ai_review_run_id' => $run->id,
                    'ai_state' => 'queued',
                    'awaiting_employee_since' => null,
                ]);
                ReviewTaskEstimateRequest::dispatch($run->id)->afterCommit();
            }

            return $run;
        });
    }
}
