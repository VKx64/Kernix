<?php

namespace App\Services;

use App\Models\Task;
use App\Models\TaskEstimateDecision;
use App\Models\TaskEstimateRequest;
use App\Models\TaskNote;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class TaskEstimateDecisionService
{
    public function __construct(private readonly TaskMessageService $messages) {}

    public function decide(
        int $requestId,
        string $action,
        ?int $approvedMinutes,
        string $reason,
        string $source,
        ?int $decidedBy = null,
        ?int $aiReviewRunId = null,
        bool $override = false,
        bool $enforceOriginalEstimate = false,
    ): TaskEstimateRequest {
        return DB::transaction(function () use (
            $requestId, $action, $approvedMinutes, $reason, $source, $decidedBy,
            $aiReviewRunId, $override, $enforceOriginalEstimate
        ): TaskEstimateRequest {
            $estimateRequest = TaskEstimateRequest::query()->lockForUpdate()->findOrFail($requestId);
            $task = Task::query()->lockForUpdate()->findOrFail($estimateRequest->task_id);
            abort_if($task->archived_at !== null, 409, 'Archived tasks cannot be changed.');
            abort_unless(in_array($action, ['approve', 'reject'], true), 422, 'Invalid estimate decision.');

            if ($override) {
                abort_unless($estimateRequest->review_mode === 'ai', 409, 'Only an AI decision can be overridden.');
                abort_unless(in_array($estimateRequest->status, ['approved', 'rejected'], true), 409, 'There is no completed AI decision to override.');
            } else {
                abort_unless($estimateRequest->status === 'pending', 409, 'This estimate request has already been resolved or replaced.');
            }

            if ($enforceOriginalEstimate) {
                abort_unless(
                    (int) ($task->estimated_minutes ?? 0) === (int) $estimateRequest->base_estimated_minutes,
                    409,
                    'The task estimate changed after this request was submitted. Ask the employee to replace the request.',
                );
            }

            $desired = $action === 'approve' ? (int) $approvedMinutes : 0;
            abort_if($action === 'approve' && $desired < 1, 422, 'Approved time must be at least one minute.');
            abort_if($desired > (int) $estimateRequest->requested_additional_minutes, 422, 'Approved time cannot exceed the employee request.');

            $priorEffective = (int) $estimateRequest->effective_additional_minutes;
            $priorStatus = $estimateRequest->status;
            $adjustment = $desired - $priorEffective;
            $task->update(['estimated_minutes' => max(0, (int) ($task->estimated_minutes ?? 0) + $adjustment)]);
            $estimateRequest->update([
                'status' => $action === 'approve' ? 'approved' : 'rejected',
                'approved_additional_minutes' => $action === 'approve' ? $desired : null,
                'effective_additional_minutes' => $desired,
                'decision_reason' => trim($reason),
                'decision_source' => $source,
                'decided_by' => $decidedBy,
                'decided_at' => now(),
                'ai_state' => $source === 'human_override' ? 'overridden' : ($estimateRequest->review_mode === 'ai' ? 'decided' : null),
                'awaiting_employee_since' => null,
            ]);
            TaskEstimateDecision::create([
                'task_estimate_request_id' => $estimateRequest->id,
                'source' => $source,
                'action' => $action,
                'approved_additional_minutes' => $action === 'approve' ? $desired : null,
                'reason' => trim($reason),
                'decided_by' => $decidedBy,
                'ai_review_run_id' => $aiReviewRunId,
                'prior_status' => $priorStatus,
                'prior_effective_additional_minutes' => $priorEffective,
            ]);

            $root = $this->rootMessage($estimateRequest);
            if ($source === 'ai') {
                $this->messages->replyAsActor($root, 'ai', $estimateRequest->requested_by, trim($reason), $aiReviewRunId);
            } elseif ($source === 'system') {
                $this->messages->replyAsActor($root, 'system', $estimateRequest->requested_by, trim($reason));
            } else {
                $this->messages->reply($root, User::findOrFail($decidedBy), $estimateRequest->requested_by, trim($reason));
            }

            $estimateRequest->aiReviewRuns()->where('status', 'queued')->update([
                'status' => 'stale',
                'finished_at' => now(),
                'error_code' => 'decision_already_completed',
            ]);

            return $estimateRequest->fresh();
        });
    }

    private function rootMessage(TaskEstimateRequest $request): TaskNote
    {
        return $request->messages()
            ->whereColumn('task_notes.id', 'task_notes.conversation_id')
            ->with('task')
            ->firstOrFail();
    }
}
