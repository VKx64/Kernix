<?php

namespace App\Models;

use App\Models\Concerns\BelongsToWorkspace;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Project extends DomainModel
{
    use BelongsToWorkspace, SoftDeletes;

    protected function casts(): array
    {
        return [
            'start_date' => 'date',
            'due_date' => 'date',
            'archived_at' => 'datetime',
            'budget_minutes' => 'integer',
            'ai_estimate_review_enabled' => 'boolean',
            'ai_task_creation_enabled' => 'boolean',
            'ai_memory_enabled' => 'boolean',
            'is_default' => 'boolean',
        ];
    }

    protected function workspaceIdFromParent(): ?int
    {
        return $this->client_id
            ? Client::acrossWorkspaces()->whereKey($this->client_id)->value('workspace_id')
            : null;
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function status(): BelongsTo
    {
        return $this->belongsTo(FieldValue::class, 'status_value_id');
    }

    public function manager(): BelongsTo
    {
        return $this->belongsTo(User::class, 'manager_user_id');
    }

    public function tasks(): HasMany
    {
        return $this->hasMany(Task::class);
    }

    public function taskFolders(): HasMany
    {
        return $this->hasMany(TaskFolder::class);
    }

    public function members(): BelongsToMany
    {
        return $this->belongsToMany(User::class)->withPivot('assigned_by')->withTimestamps();
    }

    public function aiProfile(): \Illuminate\Database\Eloquent\Relations\HasOne
    {
        return $this->hasOne(ProjectAiProfile::class);
    }

    public function memoryEntries(): HasMany
    {
        return $this->hasMany(ProjectMemoryEntry::class);
    }
}
