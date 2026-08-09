<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class TaskNote extends DomainModel
{
    use SoftDeletes;

    protected function casts(): array
    {
        return ['is_message' => 'boolean', 'read_at' => 'datetime'];
    }

    public function task(): BelongsTo
    {
        return $this->belongsTo(Task::class);
    }

    public function subtask(): BelongsTo
    {
        return $this->belongsTo(TaskSubtask::class);
    }

    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function timeLogger(): BelongsTo
    {
        return $this->belongsTo(User::class, 'time_logged_by');
    }

    public function assignedUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_user_id');
    }

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(self::class, 'conversation_id');
    }

    public function replies(): HasMany
    {
        return $this->hasMany(self::class, 'conversation_id');
    }

    public function estimateRequest(): BelongsTo
    {
        return $this->belongsTo(TaskEstimateRequest::class, 'estimate_request_id');
    }

    public function aiReviewRun(): BelongsTo
    {
        return $this->belongsTo(AiReviewRun::class);
    }

    public function attachments(): HasMany
    {
        return $this->hasMany(NoteAttachment::class, 'note_id');
    }

    public function reactions(): HasMany
    {
        return $this->hasMany(TaskNoteReaction::class, 'task_note_id')->orderBy('id');
    }
}
