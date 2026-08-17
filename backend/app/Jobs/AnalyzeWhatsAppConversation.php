<?php

namespace App\Jobs;

use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use App\Models\WhatsAppChat;
use App\Models\WhatsAppMessage;
use App\Services\WhatsAppConversationAnalyst;
use App\Services\WhatsAppDirectory;
use App\Services\WhatsAppNotifier;
use App\Services\WhatsAppTaskFactory;
use App\Support\CurrentWorkspace;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;

/**
 * Reading a conversation and raising the work in it.
 *
 * On the queue for two reasons. WhatsApp resends a message the bridge was slow to
 * acknowledge, and a model call is slow — doing this inline would turn one
 * request into three duplicate tasks. And a chat is a shared room: two people
 * saying `kernix task` within a minute of each other must not both get a batch,
 * which is what the per-chat overlap lock is for.
 */
class AnalyzeWhatsAppConversation implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 180;

    public function __construct(
        public readonly int $chatId,
        public readonly string $mode,
        public readonly ?int $requestedByUserId = null,
        public readonly ?string $instruction = null,
        public readonly ?int $triggerMessageId = null,
    ) {}

    /** @return array<int, object> */
    public function middleware(): array
    {
        return [(new WithoutOverlapping('whatsapp-chat-'.$this->chatId))->expireAfter(300)->releaseAfter(30)];
    }

    public function handle(
        WhatsAppConversationAnalyst $analyst,
        WhatsAppDirectory $directory,
        WhatsAppTaskFactory $factory,
        WhatsAppNotifier $notifier,
    ): void {
        $chat = WhatsAppChat::query()->withoutGlobalScope('workspace')->find($this->chatId);
        if (! $chat || ! $chat->mayAct()) {
            return;
        }

        CurrentWorkspace::use($chat->workspace_id, function () use ($chat, $analyst, $directory, $factory, $notifier) {
            $project = $directory->projectFor($chat);
            if (! $project) {
                return;
            }

            $result = $analyst->read($chat, $project, $this->mode, $this->instruction);

            if (! $result) {
                if ($this->mode === WhatsAppConversationAnalyst::REQUESTED) {
                    $notifier->deliver($chat, 'I could not read the conversation just now, so nothing was raised. Try again in a moment.');
                }

                return;
            }

            $tasks = $result['tasks'] === []
                ? []
                : $factory->create($chat, $project, $result['tasks'], $this->mode);

            $this->markTrigger($tasks);

            if ($tasks !== []) {
                $notifier->deliver($chat, $this->raisedMessage($tasks, $result['reply']), $tasks[0]->id);
                $this->tellTheStudio($chat, $project, $tasks, $result, $notifier);

                return;
            }

            // Nothing was raised. A client hears an acknowledgement only when
            // their message was a question somebody now owes them an answer to;
            // otherwise the assistant says nothing at all, which is what makes it
            // bearable to have in a chat.
            if ($this->mode === WhatsAppConversationAnalyst::REQUESTED) {
                $notifier->deliver($chat, $result['reply'] !== ''
                    ? $result['reply']
                    : 'I read the conversation and did not find anything that needed a task.');

                return;
            }

            if ($result['intent'] === 'answer') {
                $notifier->deliver($chat, $result['reply'] !== ''
                    ? $result['reply']
                    : 'Thanks — I have passed this to your project manager, who will come back to you.');
                $this->askTheManager($chat, $project, $result, $notifier);
            }
        });
    }

    /**
     * @param  array<int, Task>  $tasks
     */
    private function raisedMessage(array $tasks, string $reply): string
    {
        $lines = $reply !== '' ? [$reply, ''] : [];
        $lines[] = count($tasks) === 1 ? '*Raised in Kernix*' : sprintf('*Raised in Kernix — %d tasks*', count($tasks));

        foreach ($tasks as $task) {
            $assignee = $task->assignee_user_id
                ? User::query()->find($task->assignee_user_id)
                : null;
            $lines[] = sprintf(
                '#%d — %s%s',
                (int) $task->id,
                (string) $task->title,
                $assignee ? ' → '.trim($assignee->first_name.' '.$assignee->last_name) : '',
            );
        }

        return implode("\n", $lines);
    }

    /**
     * The people who now own the work hear about it in Kernix, not only in the
     * chat: assignment already reaches them, and this adds the client's own words
     * to their inbox so the thread is answerable.
     *
     * @param  array<int, Task>  $tasks
     * @param  array{summary: string, reply: string, intent: string, tasks: array}  $result
     */
    private function tellTheStudio(WhatsAppChat $chat, Project $project, array $tasks, array $result, WhatsAppNotifier $notifier): void
    {
        if ($this->mode !== WhatsAppConversationAnalyst::INTAKE) {
            return;
        }

        $manager = $project->manager_user_id ? User::query()->find($project->manager_user_id) : null;
        if (! $manager) {
            return;
        }

        $notifier->notifyUser(
            $manager,
            sprintf(
                "*%s* reported something on WhatsApp (%s).\n\n%s\n\n%s",
                $chat->label(),
                (string) $project->name,
                $result['summary'] !== '' ? $result['summary'] : 'See the tasks below.',
                implode("\n", array_map(fn (Task $task) => '#'.$task->id.' — '.$task->title, $tasks)),
            ),
            $tasks[0] ?? null,
        );
    }

    /**
     * A client asked something the assistant will not answer. Somebody has to,
     * so the project manager is told what was asked, verbatim.
     *
     * @param  array{summary: string, reply: string, intent: string, tasks: array}  $result
     */
    private function askTheManager(WhatsAppChat $chat, Project $project, array $result, WhatsAppNotifier $notifier): void
    {
        $manager = $project->manager_user_id ? User::query()->find($project->manager_user_id) : null;
        if (! $manager) {
            return;
        }

        $latest = $chat->messages()
            ->where('direction', WhatsAppMessage::INBOUND)
            ->orderByDesc('id')
            ->value('body');

        $notifier->notifyUser(
            $manager,
            sprintf(
                "*%s* asked something on WhatsApp about %s, and it needs a person:\n\n“%s”\n\nI told them you would come back to them.",
                $chat->label(),
                (string) $project->name,
                mb_substr(trim((string) $latest), 0, 700),
            ),
        );
    }

    /**
     * @param  array<int, Task>  $tasks
     */
    private function markTrigger(array $tasks): void
    {
        if (! $this->triggerMessageId) {
            return;
        }

        WhatsAppMessage::query()->withoutGlobalScope('workspace')->whereKey($this->triggerMessageId)->update([
            'status' => 'handled',
            'task_id' => $tasks[0]->id ?? null,
        ]);
    }
}
