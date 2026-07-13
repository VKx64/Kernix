<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class FieldValue extends DomainModel
{
    use SoftDeletes;

    public function field(): BelongsTo
    {
        return $this->belongsTo(Field::class);
    }
}
