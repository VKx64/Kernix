<?php

namespace App\Jobs;

use App\Models\AiReviewRun;
use App\Models\AuditLog;
use App\Models\SystemSetting;
use App\Models\TaskEstimateRequest;
use App\Services\AiEstimateReviewPrompt;
use App\Services\AiUsageService;
use App\Services\OpenRouterClient;
use App\Services\OpenRouterException;
use App\Services\TaskEstimateDecisionService;
use App\Services\TaskMessageService;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Illuminate\Support\Facades\DB;
use Throwable;

class ReviewTaskEstimateRequest implements ShouldBeEncrypted, ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 90;

    public function __construct(public readonly int $runId) {}

    public function middleware(): array
    {
        $requestId = AiReviewRun::query()->whereKey($this->runId)->value('task_estimate_request_id') ?? $this->runId;

        return [(new WithoutOverlapping('ai-estimate-request-'.$requestId))->expireAfter(180)];
    }

    public function handle(
        OpenRouterClient $client,
        AiEstimateReviewPrompt $prompt,
        TaskEstimateDecisionService $decisions,
        TaskMessageService $messages,
        AiUsageService $usage,
    ): void {
        $run = AiReviewRun::findOrFail($this->runId);
        $request = TaskEstimateRequest::with([
            'task.project', 'task.status', 'task.subtasks.status', 'task.estimateRequests', 'messages',
        ])->findOrFail($run->task_estimate_request_id);

        if (
            $run->status !== 'queued'
            || $request->status !== 'pending'
            || $request->review_mode !== 'ai'
            || ! $request->task->project->ai_estimate_review_enabled
            || $request->task->archived_at !== null
        ) {
            $run->update(['status' => 'stale', 'finished_at' => now(), 'error_code' => 'workflow_changed']);

            return;
        }

        $settings = SystemSetting::firstOrFail();
        if (blank($settings->openrouter_api_key) || blank($settings->openrouter_model)) {
            $this->block($run, $request, 'not_configured', 'OpenRouter has not been configured.');

            return;
        }
        if ($usage->spentThisMonth() >= (float) $settings->ai_monthly_budget_usd) {
            $this->block($run, $request, 'monthly_budget_reached', 'The monthly AI budget has been reached.');

            return;
        }

        $systemPrompt = $prompt->system($request, $settings);
        $context = $prompt->context($request);
        $run->update([
            'status' => 'running',
            'attempt' => (int) $run->attempt + 1,
            'requested_model' => $settings->openrouter_model,
            'context_hash' => hash('sha256', $context),
            'started_at' => now(),
            'error_code' => null,
            'error_message' => null,
        ]);

        try {
            // Exactly one provider call is made for this employee message. Failures stay pending for a human.
            $result = $client->review($settings, $systemPrompt, $context);
            $usage->record('estimate_review', 'ai_review_run', $run->id, $result, $request->task->project_id);
            if (
                $result['action'] === 'approve'
                && (int) $result['approved_additional_minutes'] > (int) $request->requested_additional_minutes
            ) {
                throw new OpenRouterException('OpenRouter approved more time than the employee requested.');
            }

            $run->update([
                'status' => 'succeeded',
                'action' => $result['action'],
                'response_message' => $result['message'],
                'evidence_summary' => $result['evidence_summary'],
                'approved_additional_minutes' => $result['approved_additional_minutes'],
                'external_generation_id' => $result['generation_id'],
                'actual_model' => $result['actual_model'],
                'prompt_tokens' => $result['prompt_tokens'],
                'completion_tokens' => $result['completion_tokens'],
                'total_tokens' => $result['total_tokens'],
                'cost_usd' => $result['cost_usd'],
                'finished_at' => now(),
            ]);

            $currentRequest = TaskEstimateRequest::query()->findOrFail($request->id);
            if (
                $currentRequest->status !== 'pending'
                || (int) $currentRequest->latest_ai_review_run_id !== (int) $run->id
            ) {
                $run->update(['status' => 'stale', 'error_code' => 'newer_reply_or_decision']);

                return;
            }

            if ($result['action'] === 'challenge') {
                DB::transaction(function () use ($request, $run, $result, $messages): void {
                    $locked = TaskEstimateRequest::query()->lockForUpdate()->findOrFail($request->id);
                    if ($locked->status !== 'pending' || (int) $locked->latest_ai_review_run_id !== (int) $run->id) {
                        $run->update(['status' => 'stale', 'error_code' => 'newer_reply_or_decision']);

                        return;
                    }
                    $root = $locked->messages()->whereColumn('task_notes.id', 'task_notes.conversation_id')->with('task')->firstOrFail();
                    $messages->replyAsActor($root, 'ai', $locked->requested_by, $result['message'], $run->id);
                    $locked->update(['ai_state' => 'waiting_employee', 'awaiting_employee_since' => now()]);
                });
            } else {
                $decisions->decide(
                    $request->id,
                    $result['action'],
                    $result['approved_additional_minutes'],
                    $result['message'],
                    'ai',
                    null,
                    $run->id,
                );
            }

            AuditLog::create([
                'user_id' => null,
                'action' => 'task.estimate_request.ai_review',
                'entity_type' => 'Task',
                'entity_id' => $request->task_id,
                'summary' => 'AI estimate review '.$result['action'],
                'changes_json' => [
                    'estimate_request_id' => $request->id,
                    'ai_review_run_id' => $run->id,
                    'action' => $result['action'],
                    'cost_usd' => $result['cost_usd'],
                ],
            ]);
        } catch (Throwable $exception) {
            $fresh = $run->fresh();
            if ($fresh->status !== 'stale') {
                $fresh->update([
                    'status' => 'failed',
                    'error_code' => $exception instanceof OpenRouterException
                        ? ($exception->statusCode ? 'http_'.$exception->statusCode : 'provider_error')
                        : 'workflow_error',
                    'error_message' => mb_substr($exception->getMessage(), 0, 2000),
                    'finished_at' => now(),
                ]);
                TaskEstimateRequest::query()
                    ->whereKey($request->id)
                    ->where('status', 'pending')
                    ->where('latest_ai_review_run_id', $run->id)
                    ->update(['ai_state' => 'failed', 'awaiting_employee_since' => null]);
            }
        }
    }

    private function block(AiReviewRun $run, TaskEstimateRequest $request, string $code, string $message): void
    {
        $status = $code === 'monthly_budget_reached' ? 'budget_blocked' : 'failed';
        $run->update([
            'status' => $status,
            'error_code' => $code,
            'error_message' => $message,
            'finished_at' => now(),
        ]);
        $request->update([
            'ai_state' => $status,
            'awaiting_employee_since' => null,
        ]);
    }
}
