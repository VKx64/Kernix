<?php

namespace App\Jobs;

use App\Models\SystemSetting;
use App\Models\TaskCompletionProof;
use App\Services\AiUsageService;
use App\Services\OpenRouterClient;
use App\Services\TaskCompletionAuditPrompt;
use App\Support\AiFeatures;
use App\Support\TaskStatuses;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Throwable;

class AuditTaskCompletionProof implements ShouldBeEncrypted, ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 120;

    public function __construct(public readonly int $proofId) {}

    public function middleware(): array
    {
        return [(new WithoutOverlapping('completion-proof-'.$this->proofId))->expireAfter(180)];
    }

    public function handle(OpenRouterClient $client, TaskCompletionAuditPrompt $prompt, AiUsageService $usage): void
    {
        $proof = TaskCompletionProof::with(['task.project', 'attachments'])->find($this->proofId);
        if (! $proof || ! $proof->isPending() || $proof->ai_state !== 'queued') {
            return;
        }

        $settings = SystemSetting::firstOrFail();
        if (! AiFeatures::enabled($settings, AiFeatures::COMPLETION_AUDIT)) {
            $this->park($proof, 'not_configured', 'The AI completion audit is switched off, so a reviewer has to settle this proof.');

            return;
        }
        if (blank($settings->openrouter_api_key) || blank($settings->openrouter_model)) {
            $this->park($proof, 'not_configured', 'The AI auditor is not configured, so a reviewer has to settle this proof.');

            return;
        }
        if ($usage->spentThisMonth() >= (float) $settings->ai_monthly_budget_usd) {
            $this->park($proof, 'budget_blocked', 'The monthly AI budget is spent, so a reviewer has to settle this proof.');

            return;
        }

        $proof->update(['ai_state' => 'running']);
        try {
            $result = $client->structured($settings, $prompt->system($settings), $prompt->context($proof), 'task_completion_audit', $prompt->schema());
            $usage->record('task_completion_audit', 'task_completion_proof', $proof->id, $result, $proof->task->project_id);
            $verdict = $result['output']['verdict'] ?? '';
            $message = trim((string) ($result['output']['message'] ?? ''));
            $missing = array_values(array_filter($result['output']['missing_evidence'] ?? [], 'is_string'));
            if (! in_array($verdict, ['approve', 'insufficient', 'reject'], true) || $message === '') {
                throw new \RuntimeException('The auditor returned an incomplete verdict.');
            }

            $approved = $verdict === 'approve';
            $proof->update([
                'status' => $approved ? 'approved' : 'rejected',
                'ai_state' => 'succeeded',
                'ai_verdict' => $verdict,
                'ai_message' => $message,
                'ai_missing_evidence' => $missing,
                'review_mode' => 'ai',
                'reviewed_at' => now(),
            ]);
            $this->settleTask($proof, $approved, $message, $missing);
        } catch (Throwable $exception) {
            $this->park($proof, 'provider_or_workflow_error', 'The AI auditor could not review this proof, so a reviewer has to settle it.', $exception->getMessage());
        }
    }

    private function settleTask(TaskCompletionProof $proof, bool $approved, string $message, array $missing): void
    {
        $task = $proof->task;
        $statusId = TaskStatuses::id($approved ? TaskStatuses::COMPLETE : TaskStatuses::NEEDS_CORRECTION);
        if ($statusId) {
            $task->update(['status_value_id' => $statusId]);
        }

        $body = $approved
            ? "AI completion audit approved this proof.\n\n".$message
            : "AI completion audit did not accept this proof.\n\n".$message
                .($missing === [] ? '' : "\n\nStill needed:\n- ".implode("\n- ", $missing));
        $note = $task->notes()->create([
            'body' => $body,
            'assigned_user_id' => $proof->submitted_by,
            'is_message' => (bool) $proof->submitted_by,
            'created_by' => $proof->submitted_by,
            'actor_type' => 'ai',
        ]);
        if ($note->is_message) {
            $note->update(['conversation_id' => $note->id]);
        }
    }

    private function park(TaskCompletionProof $proof, string $code, string $note, ?string $detail = null): void
    {
        $proof->update([
            'ai_state' => $code === 'provider_or_workflow_error' ? 'failed' : $code,
            'error_code' => $code,
            'error_message' => $detail === null ? null : mb_substr($detail, 0, 2000),
            'ai_message' => $note,
        ]);
    }
}
