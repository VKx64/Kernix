<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One thing Oliver did on someone's behalf, kept so it can be undone and so the
 * rail can show what happened today.
 */
class OliverAction extends DomainModel
{
    protected function casts(): array
    {
        return ['before' => 'array', 'after' => 'array', 'undone_at' => 'datetime'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function message(): BelongsTo
    {
        return $this->belongsTo(OliverMessage::class, 'message_id');
    }

    /** @return array<string, mixed> */
    public function toSummary(): array
    {
        return [
            'id' => (int) $this->id,
            'type' => $this->type,
            'summary' => $this->summary,
            'entity_type' => $this->entity_type,
            'entity_id' => (int) $this->entity_id,
            'undone_at' => optional($this->undone_at)->toIso8601String(),
            'created_at' => optional($this->created_at)->toIso8601String(),
        ];
    }
}
