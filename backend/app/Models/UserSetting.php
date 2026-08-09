<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One person's own preferences. Nothing reads this model directly: callers go
 * through App\Support\UserSettings, which fills the defaults and clamps the
 * values, so a half-written bag can never reach a screen.
 */
class UserSetting extends DomainModel
{
    protected function casts(): array
    {
        return [
            'values' => 'array',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
