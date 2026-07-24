<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AiReviewRun extends DomainModel
{
    protected function casts(): array
    {
        return [
            'evidence_summary' => 'array',
            'approved_additional_minutes' => 'integer',
            'prompt_tokens' => 'integer',
            'completion_tokens' => 'integer',
            'total_tokens' => 'integer',
            'cost_usd' => 'decimal:8',
            'attempt' => 'integer',
            'started_at' => 'datetime',
            'finished_at' => 'datetime',
        ];
    }

    public function estimateRequest(): BelongsTo
    {
        return $this->belongsTo(TaskEstimateRequest::class, 'task_estimate_request_id');
    }

    public function triggerNote(): BelongsTo
    {
        return $this->belongsTo(TaskNote::class, 'trigger_note_id');
    }
}
