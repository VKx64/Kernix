<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TaskNoteReaction extends DomainModel
{
    public function note(): BelongsTo
    {
        return $this->belongsTo(TaskNote::class, 'task_note_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
