<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class TaskCompletionProof extends DomainModel
{
    protected function casts(): array
    {
        return [
            'ai_missing_evidence' => 'array',
            'reviewed_at' => 'datetime',
        ];
    }

    public function task(): BelongsTo
    {
        return $this->belongsTo(Task::class);
    }

    public function submitter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'submitted_by');
    }

    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by');
    }

    public function attachments(): HasMany
    {
        return $this->hasMany(TaskAttachment::class, 'completion_proof_id');
    }

    public function isPending(): bool
    {
        return $this->status === 'pending';
    }

    /**
     * The audit could not reach a verdict, so a human has to settle it. Without
     * this the task would be stuck in Quality Check for good.
     */
    public function awaitsHumanReview(): bool
    {
        return $this->isPending() && in_array($this->ai_state, ['failed', 'budget_blocked', 'not_configured'], true);
    }

    /**
     * @return array<string, mixed>
     */
    public function toSummary(?array $submitter = null, ?array $reviewer = null): array
    {
        return [
            'id' => $this->id,
            'task_id' => $this->task_id,
            'summary' => $this->summary,
            'status' => $this->status,
            'ai_state' => $this->ai_state,
            'ai_verdict' => $this->ai_verdict,
            'ai_message' => $this->ai_message,
            'ai_missing_evidence' => $this->ai_missing_evidence ?? [],
            'awaits_human_review' => $this->awaitsHumanReview(),
            'error_code' => $this->error_code,
            'review_mode' => $this->review_mode,
            'review_reason' => $this->review_reason,
            'reviewed_at' => optional($this->reviewed_at)->toIso8601String(),
            'submitted_by' => $submitter,
            'reviewed_by' => $reviewer,
            'created_at' => optional($this->created_at)->toIso8601String(),
        ];
    }
}
