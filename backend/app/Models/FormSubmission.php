<?php

namespace App\Models;

use App\Models\Concerns\BelongsToWorkspace;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class FormSubmission extends DomainModel
{
    use BelongsToWorkspace, HasFactory;

    public const UPDATED_AT = null;

    /**
     * Anonymous-submitter PII the review UI has no use for: the IP HMAC and
     * raw user agent are captured for abuse investigation only, never for
     * display, so they are kept out of every JSON response — including the
     * staff-side FormSubmissionController reads, which otherwise inherit
     * DomainModel's `$guarded = []` with no allowlist of their own.
     *
     * @var array<int, string>
     */
    protected $hidden = ['ip_hash', 'user_agent'];

    /** Unambiguous base32: no 0/O or 1/I, so a reference read aloud is never misheard. */
    private const REFERENCE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

    /** Generates and reserves a unique human-facing reference, e.g. "SUB-4F9KQWZ2". */
    public static function generateReference(): string
    {
        do {
            $reference = 'SUB-'.self::randomReferenceSuffix(8);
        } while (self::acrossWorkspaces()->where('reference', $reference)->exists());

        return $reference;
    }

    private static function randomReferenceSuffix(int $length): string
    {
        $out = '';
        for ($i = 0; $i < $length; $i++) {
            $out .= self::REFERENCE_CHARS[random_int(0, strlen(self::REFERENCE_CHARS) - 1)];
        }

        return $out;
    }

    protected function casts(): array
    {
        return [
            'answers' => 'array',
            'form_snapshot' => 'array',
            'decided_at' => 'datetime',
        ];
    }

    protected function workspaceIdFromParent(): ?int
    {
        return $this->project_id
            ? Project::acrossWorkspaces()->whereKey($this->project_id)->value('workspace_id')
            : null;
    }

    public function form(): BelongsTo
    {
        return $this->belongsTo(ProjectForm::class, 'project_form_id');
    }

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    public function task(): BelongsTo
    {
        return $this->belongsTo(Task::class);
    }

    public function decider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'decided_by');
    }

    public function possibleDuplicateOf(): BelongsTo
    {
        return $this->belongsTo(self::class, 'possible_duplicate_of');
    }

    public function files(): HasMany
    {
        return $this->hasMany(FormSubmissionFile::class);
    }
}
