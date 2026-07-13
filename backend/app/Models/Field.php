<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Field extends DomainModel
{
    use SoftDeletes;

    protected function casts(): array
    {
        return ['is_system' => 'boolean'];
    }

    public function values(): HasMany
    {
        return $this->hasMany(FieldValue::class)->orderBy('sort_order');
    }
}
