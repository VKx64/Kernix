<?php

namespace App\Http\Controllers\Api;

use App\Models\User;
use App\Models\WhatsAppChat;
use App\Models\WhatsAppMessage;
use App\Models\Workspace;
use App\Services\WhatsAppCommandRouter;
use App\Services\WhatsAppDirectory;
use App\Services\WhatsAppNotifier;
use App\Support\CurrentWorkspace;
use App\Support\WorkspaceFeatures;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

/**
 * Where a WhatsApp message enters Kernix.
 *
 * Called by the bridge container only, with the shared secret — never by a
 * browser. Every message is written down first and interpreted second, so the
 * transcript is complete even for the ones that were refused: that log is both
 * the audit trail and the context the assistant reads when somebody asks it to
 * turn a conversation into work.
 *
 * Identity comes from the number, matched against the people and contacts
 * already in Kernix. A number nobody recognises is logged and answered with
 * silence — replying would confirm to a stranger that this number belongs to a
 * Kernix deployment and let them probe it for free.
 */
class WhatsAppWebhookController extends ApiController
{
    public function inbound(
        Request $request,
        WhatsAppDirectory $directory,
        WhatsAppCommandRouter $router,
        WhatsAppNotifier $notifier,
    ): JsonResponse {
        $data = $request->validate([
            'jid' => ['required', 'string', 'max:64'],
            'text' => ['required', 'string', 'max:5000'],
            'wa_message_id' => ['sometimes', 'nullable', 'string', 'max:96'],
            'push_name' => ['sometimes', 'nullable', 'string', 'max:120'],
            'sender_jid' => ['sometimes', 'nullable', 'string', 'max:64'],
            'sender_lid' => ['sometimes', 'nullable', 'string', 'max:64'],
            'from_me' => ['sometimes', 'boolean'],
            'chat_subject' => ['sometimes', 'nullable', 'string', 'max:191'],
            'is_group' => ['sometimes', 'boolean'],
            'timestamp' => ['sometimes', 'nullable', 'integer'],
        ]);

        $chatJid = trim($data['jid']);
        $text = trim($data['text']);
        // In a group the chat is the room and the sender is one number in it. One
        // to one, they are the same thing.
        $senderJid = trim((string) ($data['sender_jid'] ?? '')) ?: $chatJid;

        // Resolution has to see every tenant: one linked account serves the whole
        // deployment, and which workspace this is only becomes known once the
        // number matches somebody.
        [$chat, $sender] = CurrentWorkspace::withoutScope(function () use ($directory, $chatJid, $senderJid, $data) {
            // Who spoke is resolved first, because in a group that is the only
            // thing that says which tenant the room belongs to.
            $speaker = $directory->userForJid($senderJid);
            // A group is named by its subject; a person by the name on their own
            // WhatsApp. In a group the push name is the *speaker's*, so it must
            // not become the room's label.
            $chat = $directory->resolve(
                $chatJid,
                $senderJid,
                $data['chat_subject'] ?? ($senderJid === $chatJid ? $data['push_name'] ?? null : null),
                $speaker,
            );
            $sender = $chat->isGroup()
                ? $speaker
                : ($chat->user_id ? User::query()->withoutGlobalScope('workspace')->find($chat->user_id) : null);

            return [$chat, $sender];
        });

        // The linked phone's own messages arrive here too, so the person holding
        // it can work from it like anybody else. They are only ever *acted* on
        // when they address the assistant by name: without that rule the studio's
        // own side of every client conversation would be read as instructions.
        $fromMe = $request->boolean('from_me');
        $addressed = (bool) preg_match(
            '/^\s*@?'.preg_quote((string) config('services.whatsapp.trigger', 'kernix'), '/').'\b/i',
            $text,
        );

        $record = WhatsAppMessage::create([
            'workspace_id' => $chat->workspace_id,
            'chat_id' => $chat->id,
            'user_id' => $sender?->id,
            'jid' => $chatJid,
            'sender_jid' => $senderJid,
            'sender_name' => $this->senderName($data['push_name'] ?? null, $sender, $chat),
            'direction' => WhatsAppMessage::INBOUND,
            'body' => mb_substr($text, 0, 5000),
            'wa_message_id' => $data['wa_message_id'] ?? null,
            'status' => 'received',
        ]);

        if ($fromMe && ! $addressed) {
            $record->update(['status' => 'ignored', 'error' => 'own message, not addressed']);

            return $this->data(['handled' => false, 'reason' => 'not_addressed']);
        }

        if ($fromMe && ! $sender) {
            $record->update([
                'status' => 'ignored',
                'error' => 'the linked number is not on anybody\'s Kernix profile',
            ]);

            return $this->data(['handled' => false, 'reason' => 'owner_unknown']);
        }

        if (! $chat->workspace_id) {
            $record->update(['status' => 'ignored', 'error' => 'unknown sender']);

            return $this->data(['handled' => false, 'reason' => 'unknown_sender']);
        }

        $workspace = Workspace::query()->find($chat->workspace_id);
        if (! $workspace || ! WorkspaceFeatures::enabled($workspace, WorkspaceFeatures::WHATSAPP)) {
            $record->update(['status' => 'ignored', 'error' => 'feature disabled']);

            return $this->data(['handled' => false, 'reason' => 'feature_disabled']);
        }

        if ($sender && ($sender->status !== 'active' || $sender->archived_at)) {
            $record->update(['status' => 'ignored', 'error' => 'account inactive']);

            return $this->data(['handled' => false, 'reason' => 'inactive']);
        }

        // A group nobody has claimed for a project, from a number that is not one
        // of ours, is somebody else's conversation. Once a group *is* pointed at a
        // project, an unrecognised voice in it is a client on the job and what they
        // say is read.
        if ($chat->audience === WhatsAppChat::UNKNOWN && ! $sender && ! $chat->project_id) {
            $record->update(['status' => 'ignored', 'error' => 'unrecognised sender']);

            return $this->data(['handled' => false, 'reason' => 'unknown_sender']);
        }

        // From here everything runs inside that workspace, and as that person
        // when there is one, so scoped queries and permission checks behave
        // exactly as they do for a request from the browser.
        $result = CurrentWorkspace::use($workspace->id, function () use ($router, $chat, $sender, $text, $record) {
            $previous = Auth::user();
            if ($sender) {
                Auth::setUser($sender);
            }

            try {
                return $router->handle($chat, $sender, $text, $record->id);
            } finally {
                $previous ? Auth::setUser($previous) : Auth::forgetUser();
            }
        });

        $record->update([
            'status' => $result['status'],
            'task_id' => $result['task_id'],
            'conversation_id' => $result['conversation_id'],
        ]);

        if (trim($result['reply']) !== '') {
            $notifier->deliver($chat, $result['reply'], $result['task_id'], $result['conversation_id']);
        }

        return $this->data(['handled' => $result['status'] === 'handled', 'status' => $result['status']]);
    }

    private function senderName(?string $pushName, ?User $sender, WhatsAppChat $chat): ?string
    {
        if ($sender) {
            return trim($sender->first_name.' '.$sender->last_name) ?: $sender->username;
        }

        if (filled($pushName)) {
            return mb_substr((string) $pushName, 0, 191);
        }

        return $chat->isGroup() ? null : $chat->label();
    }
}
