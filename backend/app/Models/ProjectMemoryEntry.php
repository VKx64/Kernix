<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ProjectMemoryEntry extends DomainModel
{
    protected function casts(): array { return ['reviewed_at' => 'datetime']; }
    public function project(): BelongsTo { return $this->belongsTo(Project::class); }
    public function sourceTask(): BelongsTo { return $this->belongsTo(Task::class, 'source_task_id')->withTrashed(); }
    public function reviewer(): BelongsTo { return $this->belongsTo(User::class, 'reviewed_by'); }
}
