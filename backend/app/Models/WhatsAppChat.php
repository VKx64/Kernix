<?php

namespace App\Models;

use App\Models\Concerns\BelongsToWorkspace;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * One WhatsApp conversation the workspace account is part of: an individual's
 * chat, or a group.
 *
 * A row appears the first time anything is heard from or sent to that jid, and
 * carries who the other side turned out to be. Identity comes from the numbers
 * already on the personnel and contact records — the point of one shared account
 * is that nobody has to enrol.
 *
 * `project_id` is what makes a chat actionable. A group of five people talking
 * about a job has no meaning to Kernix until somebody says which project it is,
 * so tasks are never raised from an unmapped chat.
 */
class WhatsAppChat extends DomainModel
{
    use BelongsToWorkspace;

    protected $table = 'whatsapp_chats';

    public const DIRECT = 'direct';

    public const GROUP = 'group';

    public const STAFF = 'staff';

    public const CLIENT = 'client';

    public const UNKNOWN = 'unknown';

    protected function casts(): array
    {
        return [
            'intake_enabled' => 'boolean',
            'muted' => 'boolean',
            'last_inbound_at' => 'datetime',
            'last_digest_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function contact(): BelongsTo
    {
        return $this->belongsTo(Contact::class);
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    public function messages(): HasMany
    {
        return $this->hasMany(WhatsAppMessage::class, 'chat_id');
    }

    public function isGroup(): bool
    {
        return $this->kind === self::GROUP;
    }

    public function isStaff(): bool
    {
        return $this->audience === self::STAFF;
    }

    public function isClient(): bool
    {
        return $this->audience === self::CLIENT;
    }

    /** Whether the assistant may raise work from this chat right now. */
    public function mayAct(): bool
    {
        return $this->intake_enabled && ! $this->muted;
    }

    /** The number without WhatsApp's suffix. Meaningless for a group. */
    public function number(): string
    {
        return explode('@', (string) $this->jid)[0] ?? '';
    }

    public function label(): string
    {
        if (filled($this->subject)) {
            return (string) $this->subject;
        }

        return $this->isGroup() ? 'Group '.$this->number() : $this->number();
    }
}
