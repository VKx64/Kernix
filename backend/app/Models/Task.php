<?php

namespace App\Models;

use App\Models\Concerns\BelongsToWorkspace;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Task extends DomainModel
{
    use BelongsToWorkspace, SoftDeletes;

    protected function casts(): array
    {
        return ['due_date' => 'date', 'archived_at' => 'datetime'];
    }

    protected function workspaceIdFromParent(): ?int
    {
        return $this->project_id
            ? Project::acrossWorkspaces()->whereKey($this->project_id)->value('workspace_id')
            : null;
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

    public function attachments(): HasMany
    {
        return $this->hasMany(TaskAttachment::class);
    }

    public function completionProofs(): HasMany
    {
        return $this->hasMany(TaskCompletionProof::class);
    }

    public function estimateRequests(): HasMany
    {
        return $this->hasMany(TaskEstimateRequest::class);
    }

    public function workRequests(): HasMany
    {
        return $this->hasMany(TaskWorkRequest::class);
    }

    public function emails(): HasMany
    {
        return $this->hasMany(TaskEmail::class);
    }

    public function timeEntries(): HasMany
    {
        return $this->hasMany(TimeEntry::class);
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
