<?php

namespace App\Services;

use App\Jobs\AnalyzeWhatsAppConversation;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskNote;
use App\Models\User;
use App\Models\WhatsAppChat;
use App\Support\TaskMutationGuard;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Carbon;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Throwable;

/**
 * Decides what one inbound WhatsApp message means.
 *
 * The shape of this is set by there being a single linked account: a message is
 * read according to *where* it arrived and *who* sent it, not according to any
 * enrolment.
 *
 *  - **A member of the studio, one to one.** Their own account's commands, under
 *    their own permissions and the same clock rules as the web client.
 *  - **A project group.** Ignored unless addressed. Somebody has to say
 *    `kernix ...`, and then the assistant answers or turns the conversation into
 *    work. A group chat where a robot replied to every line would be muted by
 *    lunchtime.
 *  - **A client.** Never a command surface. What they write is logged as the
 *    project's conversation, and a defect or request in it is raised as work for
 *    the studio. Clients cannot clock anybody in, read anybody's task list, or
 *    reach Oliver.
 *
 * Anything that needs the model runs on the queue, not here: WhatsApp resends a
 * message the bridge did not acknowledge quickly, and one slow model call must
 * not turn into three duplicate tasks.
 */
class WhatsAppCommandRouter
{
    public function __construct(
        private readonly TimeTrackingService $timeTracking,
        private readonly TimeEntryService $timeEntries,
        private readonly TaskMutationService $taskMutations,
        private readonly TaskMessageService $taskMessages,
        private readonly WhatsAppDirectory $directory,
        private readonly WhatsAppOliverBridge $oliver,
        private readonly WhatsAppConversationAnalyst $analyst,
        private readonly WhatsAppNotifier $notifier,
    ) {}

    /**
     * @return array{reply: string, status: string, task_id: ?int, conversation_id: ?int}
     */
    public function handle(WhatsAppChat $chat, ?User $sender, string $text, ?int $messageId = null): array
    {
        $text = trim($text);

        // A client's own words are the project's conversation, whether they wrote
        // them in their own chat or in the project's group — a complaint dropped
        // into the group everybody shares is the commonest way a bug arrives.
        // Nothing they type is a command, including something that looks like one.
        if (! $sender && ($chat->isClient() || ($chat->isGroup() && $chat->project_id))) {
            return $this->intake($chat, $messageId);
        }

        if (! $sender) {
            return $this->answer('', 'ignored');
        }

        [$addressed, $body] = $this->addressed($text);

        // In a group the assistant is a participant, not a listener: it acts only
        // when spoken to. Everything else is still logged, and still becomes
        // context for the next `kernix task`.
        if ($chat->isGroup() && ! $addressed) {
            return $this->answer('', 'ignored');
        }

        [$command, $rest] = $this->split($addressed ? $body : $text);

        try {
            return match ($command) {
                'help', 'menu', '?', 'commands' => $this->answer($this->help($chat)),
                'task', 'tasks-from-chat', 'capture' => $this->captureWork($chat, $sender, $rest, $messageId),
                'link' => $this->link($chat, $sender, $rest),
                'unlink' => $this->unlink($chat, $sender),
                'mute' => $this->mute($chat, $sender, true),
                'unmute' => $this->mute($chat, $sender, false),
                'in', 'clockin' => $this->clockIn($sender, $rest),
                'out', 'clockout' => $this->clockOut($sender),
                'break', 'pause' => $this->breakStart($sender),
                'back', 'resume' => $this->breakEnd($sender),
                'status', 'now' => $this->answer($this->status($sender, $chat)),
                'my', 'mine', 'tasks' => $this->answer($this->taskList($sender)),
                'start', 'timer' => $this->startTimer($sender, $rest),
                'stop' => $this->stopTimer($sender),
                'note', 'comment' => $this->note($sender, $rest),
                'reply' => $this->reply($sender, $rest),
                'ask', 'oliver' => $this->ask($sender, $rest),
                default => $this->fallback($chat, $sender, $addressed ? $body : $text),
            };
        } catch (ValidationException $exception) {
            return $this->answer(collect($exception->errors())->flatten()->implode(' '), 'refused');
        } catch (HttpResponseException $exception) {
            // A refusal already rendered as a response — the task mutation guard
            // does this. The person gets its reason rather than a generic failure.
            $payload = json_decode((string) $exception->getResponse()->getContent(), true);

            return $this->answer((string) ($payload['message'] ?? 'That is not allowed right now.'), 'refused');
        } catch (HttpException $exception) {
            // `abort()` from a service: a missing permission, "you are already
            // clocked in", "the timer is not running". Answers, not faults.
            $message = trim($exception->getMessage());

            return $this->answer($message !== '' ? $message : 'That is not allowed right now.', 'refused');
        } catch (Throwable $exception) {
            report($exception);

            return $this->answer('Something went wrong on my side, so nothing was changed. Try again in a moment.', 'failed');
        }
    }

    public function help(WhatsAppChat $chat): string
    {
        $trigger = $this->trigger();

        if ($chat->isGroup()) {
            return implode("\n", [
                '*Kernix in this group*',
                '',
                "Say `{$trigger}` first, then:",
                '`task` — read what we have been discussing and raise the work in it',
                '`task only the API bits` — same, narrowed to what you say',
                '`link project 12` — tell me which project this group is',
                '`status` — your clock and timer',
                '`tasks` — your open tasks',
                '`mute` / `unmute` — stop and resume everything I send here',
            ]);
        }

        return implode("\n", [
            '*Kernix on WhatsApp*',
            '',
            '`in` — clock in    `out` — clock out',
            '`break` / `back` — pause and resume',
            '`status` — your clock, timer, and hours today',
            '`tasks` — your open tasks',
            '`start 123` — run the timer on task 123',
            '`stop` — stop the timer',
            '`note 123 text` — add a note to task 123',
            '`reply text` — answer your latest message thread',
            '`ask ...` — ask Oliver a question (he answers, he does not change anything)',
            '',
            'Plain text with no command replies to your latest thread.',
        ]);
    }

    // --- work out of a conversation ----------------------------------------

    /**
     * `kernix task` — read the conversation and raise what is in it. The model
     * call happens on the queue; this only decides whether it may run at all.
     */
    private function captureWork(WhatsAppChat $chat, User $sender, string $instruction, ?int $messageId): array
    {
        $this->must($sender, 'tasks.create');

        if (! $chat->mayAct()) {
            return $this->answer(
                $chat->muted
                    ? 'This chat is muted. Send `'.$this->trigger().' unmute` first.'
                    : 'Reading this chat for work is switched off in Kernix, under Workspace settings → WhatsApp.',
                'refused',
            );
        }

        $project = $this->directory->projectFor($chat);
        if (! $project) {
            return $this->answer(
                "I do not know which project this chat is about yet. Send `{$this->trigger()} link project 12` with the project's id.",
                'refused',
            );
        }

        if (! $this->analyst->available()) {
            return $this->answer('Reading conversations needs AI task creation switched on, with an OpenRouter key and model in Settings.', 'refused');
        }

        AnalyzeWhatsAppConversation::dispatch(
            $chat->id,
            WhatsAppConversationAnalyst::REQUESTED,
            $sender->id,
            $instruction !== '' ? mb_substr($instruction, 0, 1000) : null,
            $messageId,
        );

        return $this->answer('Reading the conversation now — one moment.', 'handled');
    }

    /** A client wrote in their own chat. The model decides whether that is work. */
    private function intake(WhatsAppChat $chat, ?int $messageId): array
    {
        if (! $chat->mayAct() || ! $this->analyst->available()) {
            // Still logged, and still a conversation a human can read in Kernix.
            return $this->answer('', 'ignored');
        }

        if (! $this->directory->projectFor($chat)) {
            return $this->answer('', 'ignored');
        }

        AnalyzeWhatsAppConversation::dispatch($chat->id, WhatsAppConversationAnalyst::INTAKE, null, null, $messageId);

        return $this->answer('', 'queued');
    }

    private function link(WhatsAppChat $chat, User $sender, string $rest): array
    {
        $this->must($sender, 'tasks.assign');

        if (! preg_match('/project\s*#?(\d+)/i', $rest, $matches)) {
            return $this->answer("Send `{$this->trigger()} link project 12`, using the project's id from Kernix.", 'refused');
        }

        $project = Project::query()->whereNull('archived_at')->find((int) $matches[1]);
        if (! $project) {
            return $this->answer('I cannot find project #'.$matches[1].'.', 'refused');
        }

        $chat->fill([
            'project_id' => $project->id,
            'client_id' => $chat->client_id ?: $project->client_id,
            'workspace_id' => $chat->workspace_id ?: $project->workspace_id,
        ])->save();

        return $this->answer(sprintf(
            'This chat is now project #%d — %s. Say `%s task` when you want the conversation turned into work.',
            (int) $project->id,
            (string) $project->name,
            $this->trigger(),
        ), 'handled');
    }

    private function unlink(WhatsAppChat $chat, User $sender): array
    {
        $this->must($sender, 'tasks.assign');
        $chat->fill(['project_id' => null])->save();

        return $this->answer('This chat is no longer tied to a project, so I will not raise work from it.', 'handled');
    }

    /**
     * Muting is the one command whose confirmation cannot be left to the caller:
     * a muted chat is not delivered to, so the reply would be swallowed by the
     * flag that was just set. It is sent from here, before the flag lands, and
     * the caller is handed nothing to say.
     */
    private function mute(WhatsAppChat $chat, User $sender, bool $muted): array
    {
        $this->must($sender, 'tasks.view');

        if ($muted) {
            $this->notifier->deliver($chat, 'Muted. I will not send anything here until somebody sends `'.$this->trigger().' unmute`.');
            $chat->fill(['muted' => true])->save();

            return $this->answer('', 'handled');
        }

        $chat->fill(['muted' => false])->save();

        return $this->answer('Unmuted. I will send here again.', 'handled');
    }

    // --- clock -------------------------------------------------------------

    private function clockIn(User $user, string $notes): array
    {
        $this->must($user, 'time.track');
        $session = $this->timeTracking->clockIn($user, $notes !== '' ? mb_substr($notes, 0, 500) : null);

        return $this->answer('Clocked in at '.$this->time($session->clock_in_at).'.', 'handled');
    }

    private function clockOut(User $user): array
    {
        $this->must($user, 'time.track');
        // A running task timer must not outlive the session it belongs to.
        $this->timeEntries->closeOpen($user);
        $session = $this->timeTracking->clockOut($user);
        $minutes = (int) round(Carbon::parse($session->clock_in_at)->diffInMinutes(Carbon::parse($session->clock_out_at)));

        return $this->answer(sprintf('Clocked out at %s. That is %s for the session.', $this->time($session->clock_out_at), $this->duration($minutes)), 'handled');
    }

    private function breakStart(User $user): array
    {
        $this->must($user, 'time.track');
        $this->timeTracking->breakStart($user);

        return $this->answer('On break. Send `back` when you are working again.', 'handled');
    }

    private function breakEnd(User $user): array
    {
        $this->must($user, 'time.track');
        $this->timeTracking->breakEnd($user);

        return $this->answer('Break over. Back on the clock.', 'handled');
    }

    private function status(User $user, WhatsAppChat $chat): string
    {
        $clock = $this->timeTracking->statusData($user);
        $entry = $this->timeEntries->openEntry($user);
        $lines = [
            match ($clock['state']) {
                'working' => '🟢 Working since '.$this->time($clock['started_at']).'.',
                'break' => '🟡 On break.',
                default => '⚪ Clocked out.',
            },
            sprintf('Logged today: %s.', $this->duration((int) $clock['today_minutes'])),
        ];

        if ($entry) {
            $task = $entry->task_id ? Task::query()->find($entry->task_id) : null;
            $lines[] = $task
                ? sprintf('Timer running on #%d — %s.', (int) $task->id, (string) $task->title)
                : 'Timer running, with no task attached.';
        }

        if ($chat->isGroup()) {
            $project = $this->directory->projectFor($chat);
            $lines[] = $project
                ? sprintf('This group is project #%d — %s.', (int) $project->id, (string) $project->name)
                : 'This group is not tied to a project yet.';
        }

        return implode("\n", $lines);
    }

    // --- tasks -------------------------------------------------------------

    private function taskList(User $user): string
    {
        $this->must($user, 'tasks.view');
        $tasks = Task::query()
            ->whereNull('archived_at')
            ->where(fn ($query) => $query
                ->where('assignee_user_id', $user->id)
                ->orWhereHas('assignees', fn ($assignees) => $assignees->where('users.id', $user->id)))
            ->whereHas('status', fn ($status) => $status->where('key_name', '!=', 'complete'))
            ->orderByRaw('due_date is null, due_date')
            ->limit(8)
            ->get(['id', 'title', 'due_date']);

        if ($tasks->isEmpty()) {
            return 'Nothing open is assigned to you.';
        }

        $lines = $tasks->map(fn (Task $task) => sprintf(
            '#%d — %s%s',
            (int) $task->id,
            (string) $task->title,
            $task->due_date ? ' (due '.Carbon::parse($task->due_date)->format('D j M').')' : '',
        ))->all();

        return implode("\n", array_merge(['*Your open tasks*'], $lines, ['', 'Send `start <id>` to run the timer on one.']));
    }

    private function startTimer(User $user, string $rest): array
    {
        $this->must($user, 'tasks.view');
        $taskId = (int) preg_replace('/\D+/', '', $rest);
        if ($taskId <= 0) {
            return $this->answer('Which task? Send `start 123`, or `tasks` for your list.', 'refused');
        }

        $task = Task::query()->whereNull('archived_at')->find($taskId);
        if (! $task) {
            return $this->answer("I cannot find task #{$taskId}.", 'refused');
        }

        $entry = $this->timeEntries->start($user, $task->id);

        return $this->answer(
            sprintf('Timer running on #%d — %s, from %s.', (int) $task->id, (string) $task->title, $this->time($entry->started_at)),
            'handled',
            $task->id,
        );
    }

    private function stopTimer(User $user): array
    {
        $this->must($user, 'time.track');
        $entry = $this->timeEntries->stop($user);
        $minutes = $this->timeEntries->loggedMinutes($entry);

        return $this->answer(sprintf('Timer stopped. %s logged.', $this->duration($minutes)), 'handled', $entry->task_id ? (int) $entry->task_id : null);
    }

    private function note(User $user, string $rest): array
    {
        $this->must($user, 'tasks.comment');
        if (! preg_match('/^#?(\d+)\s+(.+)$/s', trim($rest), $matches)) {
            return $this->answer('Send `note 123 what happened`.', 'refused');
        }

        $task = Task::query()->whereNull('archived_at')->find((int) $matches[1]);
        if (! $task) {
            return $this->answer('I cannot find task #'.$matches[1].'.', 'refused');
        }

        // The clock rule the web client applies to a note applies here too.
        $clock = TaskMutationGuard::clockState($user);
        if (! $clock['may_change_task_work']) {
            return $this->answer('Clock in first — send `in` — then the note will go on the task.', 'refused');
        }

        $note = $this->taskMutations->createNote($task, [
            'body' => mb_substr(trim($matches[2]), 0, 5000),
            'is_message' => false,
        ], $user);

        return $this->answer(sprintf('Noted on #%d.', (int) $task->id), 'handled', (int) $task->id, $note->conversation_id ? (int) $note->conversation_id : null);
    }

    // --- threads -----------------------------------------------------------

    private function reply(User $user, string $body): array
    {
        $body = trim($body);
        if ($body === '') {
            return $this->answer('Send `reply` followed by what you want to say.', 'refused');
        }

        $this->must($user, 'messages.view');
        $root = $this->latestThread($user);
        if (! $root) {
            return $this->answer('You have no message thread to reply to. Send `help` for what I can do.', 'refused');
        }

        $recipient = $this->threadCounterpart($root, $user);
        if (! $recipient) {
            return $this->answer('That thread has nobody left to answer.', 'refused');
        }

        $reply = $this->taskMessages->reply($root, $user, $recipient, mb_substr($body, 0, 5000));

        return $this->answer(
            sprintf('Sent to your thread on #%d.', (int) $root->task_id),
            'handled',
            $root->task_id ? (int) $root->task_id : null,
            (int) $reply->conversation_id,
        );
    }

    /**
     * The newest thread this person is the recipient of. A reply over WhatsApp
     * has no thread picker, so the only safe reading of a bare sentence is the
     * conversation they were last asked something in.
     */
    private function latestThread(User $user): ?TaskNote
    {
        $conversationId = TaskNote::query()
            ->where('is_message', true)
            ->where('assigned_user_id', $user->id)
            ->whereNotNull('conversation_id')
            ->orderByDesc('created_at')
            ->value('conversation_id');

        if (! $conversationId) {
            return null;
        }

        return TaskNote::query()->with('task')->find((int) $conversationId);
    }

    private function threadCounterpart(TaskNote $root, User $user): ?int
    {
        $messages = TaskNote::query()
            ->where('conversation_id', $root->id)
            ->orderByDesc('created_at')
            ->get(['created_by', 'assigned_user_id']);

        foreach ($messages as $message) {
            foreach ([$message->created_by, $message->assigned_user_id] as $candidate) {
                if ($candidate && (int) $candidate !== (int) $user->id) {
                    return (int) $candidate;
                }
            }
        }

        return null;
    }

    // --- questions ---------------------------------------------------------

    private function ask(User $user, string $question): array
    {
        $question = trim($question);
        if ($question === '') {
            return $this->answer('Ask a question after `ask`, e.g. `ask what is due today`.', 'refused');
        }

        return $this->answer($this->oliver->answer($user, $question), 'handled');
    }

    /**
     * No command matched. From a member of the studio one to one, an open thread
     * makes this a reply and otherwise it is a question for Oliver. Addressed in
     * a group, it is treated as a question rather than guessed at.
     */
    private function fallback(WhatsAppChat $chat, User $sender, string $text): array
    {
        if ($text === '') {
            return $this->answer($this->help($chat), 'ignored');
        }

        if (! $chat->isGroup() && $sender->canDo('messages.view') && $this->latestThread($sender)) {
            return $this->reply($sender, $text);
        }

        if ($this->oliver->available()) {
            return $this->answer($this->oliver->answer($sender, $text), 'handled');
        }

        return $this->answer("I did not recognise that.\n\n".$this->help($chat), 'ignored');
    }

    // --- helpers -----------------------------------------------------------

    /**
     * Was the assistant spoken to, and what was said after its name.
     *
     * @return array{0: bool, 1: string}
     */
    private function addressed(string $text): array
    {
        $trigger = preg_quote($this->trigger(), '/');
        if (preg_match('/^\s*@?'.$trigger.'\b[,:]?\s*(.*)$/is', $text, $matches)) {
            return [true, trim((string) ($matches[1] ?? ''))];
        }

        return [false, $text];
    }

    private function trigger(): string
    {
        return mb_strtolower((string) config('services.whatsapp.trigger', 'kernix'));
    }

    /** @return array{0: string, 1: string} */
    private function split(string $text): array
    {
        $normalized = ltrim($text, "/! \t");
        $parts = preg_split('/\s+/', $normalized, 2) ?: [];

        return [mb_strtolower((string) ($parts[0] ?? '')), (string) ($parts[1] ?? '')];
    }

    private function must(User $user, string $permission): void
    {
        abort_unless($user->canDo($permission), 403, 'Your account does not have permission for that.');
    }

    /**
     * @return array{reply: string, status: string, task_id: ?int, conversation_id: ?int}
     */
    private function answer(string $reply, string $status = 'handled', ?int $taskId = null, ?int $conversationId = null): array
    {
        return ['reply' => $reply, 'status' => $status, 'task_id' => $taskId, 'conversation_id' => $conversationId];
    }

    private function time(mixed $value): string
    {
        return $value ? Carbon::parse($value)->format('g:i A') : 'now';
    }

    private function duration(int $minutes): string
    {
        $minutes = max(0, $minutes);
        $hours = intdiv($minutes, 60);
        $rest = $minutes % 60;

        return match (true) {
            $hours > 0 && $rest > 0 => sprintf('%dh %dm', $hours, $rest),
            $hours > 0 => sprintf('%dh', $hours),
            default => sprintf('%dm', $rest),
        };
    }
}
