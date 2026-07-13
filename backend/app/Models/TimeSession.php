<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class TimeSession extends DomainModel
{
    protected function casts(): array
    {
        return ['clock_in_at' => 'datetime', 'clock_out_at' => 'datetime'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function breaks(): HasMany
    {
        return $this->hasMany(TimeBreak::class, 'session_id');
    }
}
