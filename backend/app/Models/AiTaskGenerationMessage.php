<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AiTaskGenerationMessage extends DomainModel
{
    public function generation(): BelongsTo { return $this->belongsTo(AiTaskGeneration::class, 'generation_id'); }
}
