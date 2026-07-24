<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AiTaskGenerationTask extends DomainModel
{
    public function generation(): BelongsTo { return $this->belongsTo(AiTaskGeneration::class, 'generation_id'); }
    public function task(): BelongsTo { return $this->belongsTo(Task::class); }
}
