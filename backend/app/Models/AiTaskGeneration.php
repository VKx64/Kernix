<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class AiTaskGeneration extends DomainModel
{
    protected function casts(): array
    {
        return ['undo_expires_at' => 'datetime'];
    }

    public function project(): BelongsTo { return $this->belongsTo(Project::class); }
    public function requester(): BelongsTo { return $this->belongsTo(User::class, 'requested_by'); }
    public function folder(): BelongsTo { return $this->belongsTo(TaskFolder::class, 'task_folder_id'); }
    public function messages(): HasMany { return $this->hasMany(AiTaskGenerationMessage::class, 'generation_id'); }
    public function generatedTasks(): HasMany { return $this->hasMany(AiTaskGenerationTask::class, 'generation_id'); }
}
