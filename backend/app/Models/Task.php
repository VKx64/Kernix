<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Task extends DomainModel
{
    use SoftDeletes;

    protected function casts(): array
    {
        return ['due_date' => 'date', 'archived_at' => 'datetime'];
    }

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    public function folder(): BelongsTo
    {
        return $this->belongsTo(TaskFolder::class, 'task_folder_id');
    }

    public function status(): BelongsTo
    {
        return $this->belongsTo(FieldValue::class, 'status_value_id');
    }

    public function type(): BelongsTo
    {
        return $this->belongsTo(FieldValue::class, 'type_value_id');
    }

    public function urgency(): BelongsTo
    {
        return $this->belongsTo(FieldValue::class, 'urgency_value_id');
    }

    public function assignee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assignee_user_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function subtasks(): HasMany
    {
        return $this->hasMany(TaskSubtask::class);
    }

    public function notes(): HasMany
    {
        return $this->hasMany(TaskNote::class);
    }

    public function estimateRequests(): HasMany
    {
        return $this->hasMany(TaskEstimateRequest::class);
    }

    public function emails(): HasMany
    {
        return $this->hasMany(TaskEmail::class);
    }

    public function auditLogs(): HasMany
    {
        return $this->hasMany(AuditLog::class, 'entity_id')->where('entity_type', 'Task');
    }

    public function aiGeneration(): BelongsTo
    {
        return $this->belongsTo(AiTaskGeneration::class, 'ai_task_generation_id');
    }
}
