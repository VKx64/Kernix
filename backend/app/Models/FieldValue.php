<?php

namespace App\Models;

use App\Support\TaskSignals;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class FieldValue extends DomainModel
{
    use SoftDeletes;

    // Field ids are fixed seed data (see DatabaseSeeder); keying off them here
    // avoids loading the `field` relation on every value just to read a slug.
    private const TASK_STATUS_FIELD_ID = 3;

    private const TASK_URGENCY_FIELD_ID = 4;

    protected $appends = ['role', 'rank'];

    public function field(): BelongsTo
    {
        return $this->belongsTo(Field::class);
    }

    protected function role(): Attribute
    {
        return Attribute::get(fn (): ?string => (int) $this->field_id === self::TASK_STATUS_FIELD_ID
            ? TaskSignals::statusRole($this->key_name)
            : null);
    }

    protected function rank(): Attribute
    {
        return Attribute::get(fn (): ?int => (int) $this->field_id === self::TASK_URGENCY_FIELD_ID
            ? TaskSignals::urgencyRank($this->key_name)
            : null);
    }
}
