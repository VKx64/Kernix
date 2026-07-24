<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TaskEstimateDecision extends DomainModel
{
    public $timestamps = false;

    protected function casts(): array
    {
        return [
            'approved_additional_minutes' => 'integer',
            'prior_effective_additional_minutes' => 'integer',
            'created_at' => 'datetime',
        ];
    }

    public function estimateRequest(): BelongsTo
    {
        return $this->belongsTo(TaskEstimateRequest::class, 'task_estimate_request_id');
    }

    public function decider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'decided_by');
    }

    public function aiReviewRun(): BelongsTo
    {
        return $this->belongsTo(AiReviewRun::class, 'ai_review_run_id');
    }
}
