<?php

namespace App\Models;

use Carbon\Carbon;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TimesheetDescription extends DomainModel
{
    /**
     * A plain `Y-m-d` string in and out. A datetime cast would write
     * "2026-08-03 00:00:00" into the date column, which then fails to match the
     * date the timesheet looks the row up by.
     */
    protected function workDate(): Attribute
    {
        return Attribute::make(
            get: fn (?string $value) => $value === null ? null : Carbon::parse($value)->toDateString(),
            set: fn (mixed $value) => Carbon::parse($value)->toDateString(),
        );
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function task(): BelongsTo
    {
        return $this->belongsTo(Task::class);
    }
}
