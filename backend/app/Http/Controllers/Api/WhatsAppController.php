<?php

namespace App\Http\Controllers\Api;

use App\Models\Project;
use App\Models\WhatsAppChat;
use App\Models\WhatsAppMessage;
use App\Services\WhatsAppClient;
use App\Services\WhatsAppNotifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Throwable;

/**
 * Operating the one WhatsApp account the workspace speaks through.
 *
 * All of it is settings work. Scanning the QR puts a real phone's session in the
 * app's hands, and saying which project a group chat belongs to decides where
 * work raised from that conversation lands — neither is a personal preference,
 * so both need `settings.edit`.
 *
 * The one thing an ordinary employee controls is whether their own notifications
 * go to WhatsApp, and that lives with their other preferences in
 * `/api/me/settings`, not here.
 */
class WhatsAppController extends ApiController
{
    public function __construct(private readonly WhatsAppClient $client) {}

    /** The connection the whole workspace shares, plus its pairing QR. */
    public function bridge(Request $request): JsonResponse
    {
        $this->permission($request, 'settings.view');

        if (! $this->client->configured()) {
            return $this->data([
                'configured' => false,
                'state' => 'not_configured',
                'jid' => null,
                'qr' => null,
                'pair_code' => null,
                'last_error' => null,
                'connected_at' => null,
                'trigger' => $this->trigger(),
            ]);
        }

        try {
            return $this->data(['configured' => true, 'trigger' => $this->trigger()] + $this->client->status());
        } catch (Throwable $exception) {
            report($exception);

            return $this->data([
                'configured' => true,
                'state' => 'unreachable',
                'jid' => null,
                'qr' => null,
                'pair_code' => null,
                'last_error' => $exception->getMessage(),
                'connected_at' => null,
                'trigger' => $this->trigger(),
            ]);
        }
    }

    /** Offer a fresh QR, which is how a different WhatsApp account is linked. */
    public function pair(Request $request): JsonResponse
    {
        $this->permission($request, 'settings.edit');
        $status = $this->client->pair();
        $this->audit($request, 'whatsapp.bridge.pair', null);

        return $this->data(['configured' => true, 'trigger' => $this->trigger()] + $status);
    }

    /**
     * The friendlier half of pairing: WhatsApp's "Link with phone number instead".
     * Same authority as showing the QR, since it links the same account.
     */
    public function pairCode(Request $request): JsonResponse
    {
        $this->permission($request, 'settings.edit');
        $data = $request->validate([
            'phone' => ['required', 'string', 'max:32'],
        ]);

        $status = $this->client->pairCode($data['phone']);
        $this->audit($request, 'whatsapp.bridge.pair_code', null);

        return $this->data(['configured' => true, 'trigger' => $this->trigger()] + $status);
    }

    public function logout(Request $request): JsonResponse
    {
        $this->permission($request, 'settings.edit');
        $status = $this->client->logout();
        $this->audit($request, 'whatsapp.bridge.logout', null);

        return $this->data(['configured' => true, 'trigger' => $this->trigger()] + $status);
    }

    /**
     * Every chat the account is in: who each one turned out to be, and which
     * project its work goes to. This is the screen that makes the integration
     * legible — without it, a group chat is a phone number nobody recognises.
     */
    public function chats(Request $request): JsonResponse
    {
        $this->permission($request, 'settings.view');

        $chats = WhatsAppChat::query()
            ->with(['user', 'contact', 'client', 'project'])
            ->orderByRaw('last_inbound_at is null, last_inbound_at desc')
            ->limit(200)
            ->get()
            ->map(fn (WhatsAppChat $chat) => $this->present($chat));

        return $this->data($chats);
    }

    /** Say what a chat is: its project, and whether work may be raised from it. */
    public function updateChat(Request $request, WhatsAppChat $chat): JsonResponse
    {
        $this->permission($request, 'settings.edit');
        $data = $request->validate([
            'project_id' => ['sometimes', 'nullable', Rule::exists('projects', 'id')->whereNull('deleted_at')],
            'intake_enabled' => ['sometimes', 'boolean'],
            'muted' => ['sometimes', 'boolean'],
        ]);

        if (array_key_exists('project_id', $data)) {
            $project = $data['project_id'] ? Project::query()->findOrFail($data['project_id']) : null;
            $chat->project_id = $project?->id;
            // A chat pointed at a project inherits that project's client, so a
            // digest knows who it is talking to.
            $chat->client_id = $project?->client_id ?? $chat->client_id;
            $chat->workspace_id = $chat->workspace_id ?: $project?->workspace_id;
        }

        foreach (['intake_enabled', 'muted'] as $flag) {
            if (array_key_exists($flag, $data)) {
                $chat->{$flag} = (bool) $data[$flag];
            }
        }

        $chat->save();
        $this->audit($request, 'whatsapp.chat.update', $chat, $data);

        return $this->data($this->present($chat->fresh(['user', 'contact', 'client', 'project'])));
    }

    /** Prove the whole path end to end, from this app to that chat. */
    public function test(Request $request, WhatsAppChat $chat, WhatsAppNotifier $notifier): JsonResponse
    {
        $this->permission($request, 'settings.edit');

        $message = $notifier->deliver($chat, 'Test message from Kernix. If you can read this, delivery to this chat works.');
        abort_unless($message, 409, 'Nothing was sent: the bridge is not configured, the chat is muted, or WhatsApp is switched off for this workspace.');

        return $this->data(['queued' => true, 'message_id' => $message->id]);
    }

    /** The delivery log, newest first: what left, what arrived, what failed. */
    public function messages(Request $request): JsonResponse
    {
        $this->permission($request, 'settings.view');
        $messages = WhatsAppMessage::query()
            ->with(['user', 'chat'])
            ->when($request->integer('chat_id'), fn ($query, $chatId) => $query->where('chat_id', $chatId))
            ->latest('id')
            ->limit(min(200, max(1, $request->integer('limit', 50))))
            ->get()
            ->map(fn (WhatsAppMessage $message) => [
                'id' => $message->id,
                'chat_id' => $message->chat_id,
                'chat' => $message->chat?->label(),
                'direction' => $message->direction,
                'status' => $message->status,
                'sender_name' => $message->sender_name,
                'body' => mb_substr((string) $message->body, 0, 500),
                'task_id' => $message->task_id,
                'error' => $message->error,
                'user' => $this->userSummary($message->user),
                'created_at' => $message->created_at?->toIso8601String(),
            ]);

        return $this->data($messages);
    }

    /** @return array<string, mixed> */
    private function present(WhatsAppChat $chat): array
    {
        return [
            'id' => $chat->id,
            'jid' => $chat->jid,
            'kind' => $chat->kind,
            'label' => $chat->label(),
            'number' => $chat->isGroup() ? null : $chat->number(),
            'audience' => $chat->audience,
            'intake_enabled' => $chat->intake_enabled,
            'muted' => $chat->muted,
            'project' => $this->projectSummary($chat->project),
            'client' => $this->clientSummary($chat->client),
            'user' => $this->userSummary($chat->user),
            'contact' => $chat->contact ? [
                'id' => $chat->contact->id,
                'name' => trim($chat->contact->first_name.' '.$chat->contact->last_name),
            ] : null,
            'last_inbound_at' => $chat->last_inbound_at?->toIso8601String(),
            'last_digest_at' => $chat->last_digest_at?->toIso8601String(),
        ];
    }

    private function trigger(): string
    {
        return (string) config('services.whatsapp.trigger', 'kernix');
    }
}
