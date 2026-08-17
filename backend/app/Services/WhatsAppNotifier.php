<?php

namespace App\Services;

use App\Jobs\SendWhatsAppMessage;
use App\Models\Contact;
use App\Models\Task;
use App\Models\TaskNote;
use App\Models\User;
use App\Models\WhatsAppChat;
use App\Models\WhatsAppMessage;
use App\Models\Workspace;
use App\Support\UserSettings;
use App\Support\WorkspaceFeatures;
use Illuminate\Support\Carbon;

/**
 * Everything Kernix says on WhatsApp goes out through here.
 *
 * One account speaks for the workspace, so "who may be messaged" is not a
 * per-person enrolment but a chain of switches, and the strictest wins:
 *
 *  - the deployment has a bridge configured;
 *  - the workspace has the feature on;
 *  - the chat is not muted;
 *  - and, for an employee, they have not turned their own WhatsApp
 *    notifications off. A client has no such switch — the whole point of their
 *    chat is that the studio talks to them in it — but muting the chat stops
 *    everything, and that is the control an operator has.
 *
 * Nothing is sent inline. The row is written first and the queue delivers it, so
 * a bridge that is reconnecting can never fail somebody's save.
 */
class WhatsAppNotifier
{
    public function __construct(
        private readonly WhatsAppClient $client,
        private readonly WhatsAppDirectory $directory,
    ) {}

    /** Deliver to a chat that has already been resolved. */
    public function deliver(WhatsAppChat $chat, string $body, ?int $taskId = null, ?int $conversationId = null): ?WhatsAppMessage
    {
        $body = trim($body);
        if ($body === '' || ! $this->client->configured() || $chat->muted) {
            return null;
        }

        if (! $this->enabledForWorkspace($chat->workspace_id)) {
            return null;
        }

        $message = WhatsAppMessage::create([
            'workspace_id' => $chat->workspace_id,
            'chat_id' => $chat->id,
            'user_id' => $chat->user_id,
            'jid' => $chat->jid,
            'direction' => WhatsAppMessage::OUTBOUND,
            'body' => $body,
            'task_id' => $taskId,
            'conversation_id' => $conversationId,
            'status' => 'queued',
        ]);

        SendWhatsAppMessage::dispatch($message->id);

        return $message;
    }

    /**
     * Message an employee on the number in their personnel record. Their own
     * preference applies, unless this is a direct answer to something they just
     * sent — silence there reads as a broken integration rather than a respected
     * setting.
     */
    public function notifyUser(User $user, string $body, ?Task $task = null, ?int $conversationId = null, bool $respectPreference = true): ?WhatsAppMessage
    {
        if ($respectPreference && ! UserSettings::for($user)['notify_whatsapp']) {
            return null;
        }

        $chat = $this->directory->chatForUser($user);

        return $chat ? $this->deliver($chat, $body, $task?->id, $conversationId) : null;
    }

    public function notifyContact(Contact $contact, string $body, ?Task $task = null): ?WhatsAppMessage
    {
        $chat = $this->directory->chatForContact($contact);

        return $chat ? $this->deliver($chat, $body, $task?->id) : null;
    }

    /**
     * A directed message inside a task thread. One hook covers most of the app:
     * work requests, estimate decisions, and plain messages all reach their
     * recipient as a directed note.
     */
    public function taskMessage(TaskNote $note): ?WhatsAppMessage
    {
        if (! $note->is_message || ! $note->assigned_user_id) {
            return null;
        }

        $recipient = User::query()->withoutGlobalScope('workspace')->find($note->assigned_user_id);
        if (! $recipient || $recipient->archived_at) {
            return null;
        }

        // A person's own message must not come back to them on their phone.
        if ((int) $note->created_by === (int) $recipient->id) {
            return null;
        }

        $task = $note->task;
        $author = $note->created_by ? User::query()->withoutGlobalScope('workspace')->find($note->created_by) : null;
        $from = $author ? trim($author->first_name.' '.$author->last_name) : ucfirst((string) ($note->actor_type ?: 'Kernix'));

        return $this->notifyUser(
            $recipient,
            sprintf(
                "*%s* on task #%d — %s\n\n%s\n\nReply to this chat to answer.",
                $from !== '' ? $from : 'Kernix',
                (int) ($task?->id ?? 0),
                (string) ($task?->title ?? 'a task'),
                $this->clip((string) $note->body, 900),
            ),
            $task,
            $note->conversation_id ? (int) $note->conversation_id : null,
        );
    }

    /** Somebody has just been put on a task. */
    public function taskAssigned(Task $task, User $assignee, ?User $actor = null): ?WhatsAppMessage
    {
        if ($actor && (int) $actor->id === (int) $assignee->id) {
            return null;
        }

        $due = $task->due_date ? ' — due '.Carbon::parse($task->due_date)->toFormattedDateString() : '';

        return $this->notifyUser(
            $assignee,
            sprintf(
                "You have been assigned task #%d%s\n\n*%s*\n\nSend `tasks` for your list, or `start %d` to run the timer on it.",
                (int) $task->id,
                $due,
                $this->clip((string) $task->title, 200),
                (int) $task->id,
            ),
            $task,
        );
    }

    private function enabledForWorkspace(?int $workspaceId): bool
    {
        // An unresolved chat belongs to no tenant, so no tenant has agreed to
        // message it.
        if (! $workspaceId) {
            return false;
        }

        $workspace = Workspace::query()->find($workspaceId);

        return $workspace !== null && WorkspaceFeatures::enabled($workspace, WorkspaceFeatures::WHATSAPP);
    }

    private function clip(string $value, int $limit): string
    {
        $value = trim(strip_tags($value));

        return mb_strlen($value) > $limit ? mb_substr($value, 0, $limit - 1).'…' : $value;
    }
}
