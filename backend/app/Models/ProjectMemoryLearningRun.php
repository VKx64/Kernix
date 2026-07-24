<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ProjectMemoryLearningRun extends DomainModel
{
    public function task(): BelongsTo { return $this->belongsTo(Task::class); }
    public function project(): BelongsTo { return $this->belongsTo(Project::class); }
}
