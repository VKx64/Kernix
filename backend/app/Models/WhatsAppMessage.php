<?php

namespace App\Models;

use App\Models\Concerns\BelongsToWorkspace;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Every message the bridge carried, in either direction, including the ones that
 * were refused.
 *
 * It serves two purposes at once. It is the audit trail — the only place an
 * operator can answer "did that reminder actually leave, and what came back",
 * since WhatsApp itself is on somebody's phone. And it is the transcript the
 * assistant reads when it is asked to turn a conversation into work: the recent
 * inbound rows of one chat are exactly the context for that.
 */
class WhatsAppMessage extends DomainModel
{
    use BelongsToWorkspace;

    protected $table = 'whatsapp_messages';

    /** A message hangs off its chat, so it lands in the same tenant. */
    protected function workspaceIdFromParent(): ?int
    {
        return $this->chat_id
            ? WhatsAppChat::query()->withoutGlobalScope('workspace')->whereKey($this->chat_id)->value('workspace_id')
            : null;
    }

    public const INBOUND = 'in';

    public const OUTBOUND = 'out';

    public function chat(): BelongsTo
    {
        return $this->belongsTo(WhatsAppChat::class, 'chat_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function task(): BelongsTo
    {
        return $this->belongsTo(Task::class);
    }

    /** How this line reads in a transcript handed to the model. */
    public function transcriptLine(): string
    {
        $who = match (true) {
            $this->direction === self::OUTBOUND => 'Kernix',
            filled($this->sender_name) => (string) $this->sender_name,
            default => 'Unknown',
        };

        return sprintf('[%s] %s: %s', $this->created_at?->format('D H:i') ?? '', $who, (string) $this->body);
    }
}
