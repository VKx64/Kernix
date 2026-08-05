<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class TaskAttachment extends DomainModel
{
    use SoftDeletes;

    public const UPDATED_AT = null;

    /**
     * Served back to the browser as-is. Anything outside this list downloads
     * instead, so an uploaded document can never execute in a viewer's tab.
     */
    public const INLINE_MIME_TYPES = [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/bmp',
        'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
        'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm',
        'application/pdf',
    ];

    public function task(): BelongsTo
    {
        return $this->belongsTo(Task::class);
    }

    public function uploader(): BelongsTo
    {
        return $this->belongsTo(User::class, 'uploaded_by');
    }

    public function mimeType(): string
    {
        return (string) ($this->mime_type ?: 'application/octet-stream');
    }

    public function canPreview(): bool
    {
        return in_array($this->mimeType(), self::INLINE_MIME_TYPES, true);
    }

    /**
     * The stored path and generated file name stay server-side; clients address
     * an attachment by id through the task-scoped routes.
     *
     * @return array<string, mixed>
     */
    public function toSummary(?array $uploader = null): array
    {
        return [
            'id' => $this->id,
            'task_id' => $this->task_id,
            'original_name' => $this->original_name,
            'mime_type' => $this->mimeType(),
            'file_size' => (int) $this->file_size,
            'can_preview' => $this->canPreview(),
            'uploaded_by' => $uploader,
            'created_at' => optional($this->created_at)->toIso8601String(),
        ];
    }
}
