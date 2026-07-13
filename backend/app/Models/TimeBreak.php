<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TimeBreak extends DomainModel
{
    protected function casts(): array
    {
        return ['start_at' => 'datetime', 'end_at' => 'datetime'];
    }

    public function session(): BelongsTo
    {
        return $this->belongsTo(TimeSession::class, 'session_id');
    }
}
