<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class TaskEstimateRequest extends DomainModel
{
    protected function casts(): array
    {
        return [
            'base_estimated_minutes' => 'integer',
            'requested_additional_minutes' => 'integer',
            'approved_additional_minutes' => 'integer',
            'effective_additional_minutes' => 'integer',
            'decided_at' => 'datetime',
            'awaiting_employee_since' => 'datetime',
        ];
    }

    public function task(): BelongsTo
    {
        return $this->belongsTo(Task::class);
    }

    public function requester(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requested_by');
    }

    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewer_user_id');
    }

    public function decider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'decided_by');
    }

    public function replacement(): BelongsTo
    {
        return $this->belongsTo(self::class, 'replaced_by_id');
    }

    public function messages(): HasMany
    {
        return $this->hasMany(TaskNote::class, 'estimate_request_id')->where('is_message', true);
    }

    public function aiReviewRuns(): HasMany
    {
        return $this->hasMany(AiReviewRun::class);
    }

    public function latestAiReviewRun(): BelongsTo
    {
        return $this->belongsTo(AiReviewRun::class, 'latest_ai_review_run_id');
    }

    public function decisions(): HasMany
    {
        return $this->hasMany(TaskEstimateDecision::class)->orderBy('created_at');
    }
}
