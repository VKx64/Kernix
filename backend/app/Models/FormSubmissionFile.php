<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class FormSubmissionFile extends DomainModel
{
    use HasFactory, SoftDeletes;

    public const UPDATED_AT = null;

    public function submission(): BelongsTo
    {
        return $this->belongsTo(FormSubmission::class, 'form_submission_id');
    }

    public function mimeType(): string
    {
        return (string) ($this->mime_type ?: 'application/octet-stream');
    }

    /** Same allowlist TaskAttachment uses to decide inline-vs-download: safe to view in a sandboxed tab. */
    public function canPreview(): bool
    {
        return in_array($this->mimeType(), TaskAttachment::INLINE_MIME_TYPES, true);
    }
}
