<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

class OliverMessage extends DomainModel
{
    public const UPDATED_AT = null;

    protected function casts(): array
    {
        return ['actions' => 'array'];
    }

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(OliverConversation::class, 'conversation_id');
    }

    /**
     * @return array<string, mixed>
     */
    public function toSummary(): array
    {
        return [
            'id' => $this->id,
            'role' => $this->role,
            'body' => $this->body,
            'actions' => $this->actions ?? [],
            'error_code' => $this->error_code,
            'created_at' => optional($this->created_at)->toIso8601String(),
        ];
    }
}
