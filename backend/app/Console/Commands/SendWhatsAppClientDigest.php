<?php

namespace App\Console\Commands;

use App\Models\Project;
use App\Models\Task;
use App\Models\WhatsAppChat;
use App\Models\Workspace;
use App\Services\WhatsAppDirectory;
use App\Services\WhatsAppNotifier;
use App\Support\CurrentWorkspace;
use App\Support\TaskStatuses;
use App\Support\WorkspaceFeatures;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Throwable;

/**
 * What is new on a client's project, in their own chat.
 *
 * Written the way a producer would write it: what got finished, what is being
 * worked on, what the studio is waiting on them for. No task ids the client has
 * no access to, no internal status names, no hours.
 *
 * A project with nothing to report is skipped rather than padded. "No progress
 * this week" is a conversation for a person to have, not a scheduled message.
 */
class SendWhatsAppClientDigest extends Command
{
    protected $signature = 'whatsapp:client-digest
        {--dry-run : Print what would be sent without sending it}
        {--chat= : Limit to one chat id}
        {--days=7 : How far back "what is new" reaches}';

    protected $description = 'Send each client chat a plain-language update on their project.';

    public function handle(WhatsAppNotifier $notifier, WhatsAppDirectory $directory): int
    {
        $sent = 0;
        $since = now()->subDays(max(1, (int) $this->option('days')));

        foreach ($this->workspaces() as $workspaceId) {
            CurrentWorkspace::use($workspaceId, function () use ($notifier, $directory, $since, &$sent) {
                foreach ($this->chats() as $chat) {
                    $project = $directory->projectFor($chat);
                    if (! $project) {
                        continue;
                    }

                    $body = $this->message($project, $since);
                    if ($body === null) {
                        continue;
                    }

                    if ($this->option('dry-run')) {
                        $this->line(sprintf("--- %s (%s)\n%s", $chat->label(), $project->name, $body));

                        continue;
                    }

                    try {
                        if ($notifier->deliver($chat, $body)) {
                            $chat->forceFill(['last_digest_at' => now()])->save();
                            $sent++;
                        }
                    } catch (Throwable $exception) {
                        report($exception);
                    }
                }
            });
        }

        $this->info($this->option('dry-run') ? 'Dry run complete.' : "Queued {$sent} client update(s).");

        return self::SUCCESS;
    }

    /** @return Collection<int, WhatsAppChat> */
    private function chats(): Collection
    {
        $only = (int) $this->option('chat');

        // A client's own chat, and any group pointed at a project — in practice the
        // shared project group is where the client actually reads things, so
        // leaving it out would mean writing an update nobody sees. A group that
        // should not get one is muted.
        return WhatsAppChat::query()
            ->where('muted', false)
            ->where(fn ($query) => $query
                ->where('audience', WhatsAppChat::CLIENT)
                ->orWhere(fn ($group) => $group->where('kind', WhatsAppChat::GROUP)->whereNotNull('project_id')))
            ->when($only > 0, fn ($query) => $query->whereKey($only))
            ->get();
    }

    private function message(Project $project, Carbon $since): ?string
    {
        $completeId = TaskStatuses::id(TaskStatuses::COMPLETE);

        $finished = Task::query()
            ->where('project_id', $project->id)
            ->whereNull('archived_at')
            ->where('status_value_id', $completeId)
            ->where('updated_at', '>=', $since)
            ->orderByDesc('updated_at')
            ->limit(8)
            ->get(['id', 'title']);

        $inFlight = Task::query()
            ->where('project_id', $project->id)
            ->whereNull('archived_at')
            ->whereHas('status', fn ($status) => $status->where('key_name', 'in_progress'))
            ->orderByRaw('due_date is null, due_date')
            ->limit(5)
            ->get(['id', 'title', 'due_date']);

        $waiting = Task::query()
            ->where('project_id', $project->id)
            ->whereNull('archived_at')
            ->whereHas('status', fn ($status) => $status->whereIn('key_name', ['blocked', 'needs_correction']))
            ->limit(5)
            ->get(['id', 'title']);

        if ($finished->isEmpty() && $inFlight->isEmpty() && $waiting->isEmpty()) {
            return null;
        }

        $lines = [sprintf('*%s — where we are*', (string) $project->name)];

        if ($finished->isNotEmpty()) {
            $lines[] = '';
            $lines[] = 'Finished since '.$since->format('j M').':';
            foreach ($finished as $task) {
                $lines[] = '• '.(string) $task->title;
            }
        }

        if ($inFlight->isNotEmpty()) {
            $lines[] = '';
            $lines[] = 'In progress now:';
            foreach ($inFlight as $task) {
                $lines[] = '• '.(string) $task->title
                    .($task->due_date ? ' (aiming for '.Carbon::parse($task->due_date)->format('j M').')' : '');
            }
        }

        if ($waiting->isNotEmpty()) {
            $lines[] = '';
            $lines[] = 'Waiting on a decision or content:';
            foreach ($waiting as $task) {
                $lines[] = '• '.(string) $task->title;
            }
            $lines[] = '';
            $lines[] = 'If any of those are with you, a reply here is enough and we will pick it up.';
        } else {
            $lines[] = '';
            $lines[] = 'Anything to add or report, just reply here.';
        }

        return implode("\n", $lines);
    }

    /** @return array<int, int> */
    private function workspaces(): array
    {
        return CurrentWorkspace::withoutScope(fn () => Workspace::query()
            ->where(WorkspaceFeatures::enabledColumn(WorkspaceFeatures::WHATSAPP), true)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all());
    }
}
