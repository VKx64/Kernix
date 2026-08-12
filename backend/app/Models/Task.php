<?php

namespace App\Models;

use App\Models\Concerns\BelongsToWorkspace;
use App\Support\TaskAssigneeSync;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Task extends DomainModel
{
    use BelongsToWorkspace, SoftDeletes;

    protected function casts(): array
    {
        return ['due_date' => 'date', 'archived_at' => 'datetime'];
    }

    /**
     * Direct single-model writes to `assignee_user_id` (tests, factories,
     * other call sites this slice does not own) never go through
     * `TaskAssigneeSync::apply`, so the pivot has to be reconciled here.
     * Idempotent — see `TaskAssigneeSync::reconcileFromColumn` for why this
     * is safe to run on every save without disturbing a pivot that already
     * agrees with the column.
     *
     * This cannot reach a bulk `Builder::update()` (no Eloquent model event
     * fires for those), which is why `hasAssignee()` below and the
     * controller's assignment filters check the column directly instead of
     * trusting the pivot alone.
     */
    protected static function booted(): void
    {
        static::saved(function (Task $task) {
            TaskAssigneeSync::reconcileFromColumn($task);
        });
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

    /**
     * The pivot is the source of truth for assignment; `assignee_user_id`
     * stays in sync as the first id here (see `TaskAssigneeSync`). Ordered
     * by the pivot's own `id` so "first assignee" is deterministic rather
     * than whatever order the query planner returns.
     */
    public function assignees(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'task_assignees')
            ->withTimestamps()
            ->orderBy('task_assignees.id');
    }

    /**
     * The single definition of "is this person assigned to this task":
     * pivot membership OR a matching `assignee_user_id`. See the union note
     * on `TaskAssigneeSync` — the column has to be checked directly here too,
     * because at least one out-of-scope call site writes it through a bulk
     * `Builder::update()` that the pivot can never observe.
     */
    public function hasAssignee(User $user): bool
    {
        if ((int) $this->assignee_user_id === (int) $user->getKey()) {
            return true;
        }
        if ($this->relationLoaded('assignees')) {
            return $this->assignees->contains('id', $user->getKey());
        }

        return $this->assignees()->whereKey($user->getKey())->exists();
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

    public function formSubmission(): BelongsTo
    {
        return $this->belongsTo(FormSubmission::class);
    }
}
