<?php

namespace App\Console\Commands;

use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use App\Models\Workspace;
use App\Services\WhatsAppNotifier;
use App\Support\CurrentWorkspace;
use App\Support\WorkspaceFeatures;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Throwable;

/**
 * What a project manager needs to know before the day starts: what has slipped on
 * their projects, what is unassigned, and what came in from clients overnight.
 *
 * Scoped to the projects they actually manage. A brief covering the whole studio
 * would be somebody else's problem list, and the point of this one is that every
 * line on it is theirs to move.
 */
class SendWhatsAppManagerBrief extends Command
{
    protected $signature = 'whatsapp:manager-brief
        {--dry-run : Print what would be sent without sending it}
        {--user= : Limit to one manager account id}';

    protected $description = 'Brief each project manager on WhatsApp about slipped, unassigned, and newly raised work.';

    public function handle(WhatsAppNotifier $notifier): int
    {
        $sent = 0;

        foreach ($this->workspaces() as $workspaceId) {
            CurrentWorkspace::use($workspaceId, function () use ($notifier, &$sent) {
                foreach ($this->managers() as $manager) {
                    $projectIds = Project::query()
                        ->where('manager_user_id', $manager->id)
                        ->whereNull('archived_at')
                        ->pluck('id');

                    if ($projectIds->isEmpty()) {
                        continue;
                    }

                    $body = $this->message($manager, $projectIds);
                    if ($body === null) {
                        continue;
                    }

                    if ($this->option('dry-run')) {
                        $this->line(sprintf("--- %s\n%s", $manager->username, $body));

                        continue;
                    }

                    try {
                        if ($notifier->notifyUser($manager, $body)) {
                            $sent++;
                        }
                    } catch (Throwable $exception) {
                        report($exception);
                    }
                }
            });
        }

        $this->info($this->option('dry-run') ? 'Dry run complete.' : "Queued {$sent} manager brief(s).");

        return self::SUCCESS;
    }

    /** @return Collection<int, User> */
    private function managers(): Collection
    {
        $only = (int) $this->option('user');

        return User::query()
            ->whereIn('id', Project::query()->whereNull('archived_at')->whereNotNull('manager_user_id')->distinct()->pluck('manager_user_id'))
            ->where('status', 'active')
            ->whereNull('archived_at')
            ->when($only > 0, fn ($query) => $query->whereKey($only))
            ->get();
    }

    /**
     * @param  Collection<int, int>  $projectIds
     */
    private function message(User $manager, Collection $projectIds): ?string
    {
        $open = fn () => Task::query()
            ->whereIn('project_id', $projectIds)
            ->whereNull('archived_at')
            ->whereHas('status', fn ($status) => $status->where('key_name', '!=', 'complete'));

        $overdue = $open()
            ->whereNotNull('due_date')
            ->whereDate('due_date', '<', today())
            ->orderBy('due_date')
            ->limit(8)
            ->get(['id', 'title', 'due_date', 'assignee_user_id']);

        $unassigned = $open()
            ->whereNull('assignee_user_id')
            ->orderByDesc('id')
            ->limit(5)
            ->get(['id', 'title']);

        // Anything the assistant raised out of a WhatsApp conversation in the last
        // day: the manager may not have been in that chat.
        $fromChats = $open()
            ->where('created_at', '>=', now()->subDay())
            ->whereHas('notes', fn ($notes) => $notes->where('actor_type', 'whatsapp'))
            ->orderByDesc('id')
            ->limit(6)
            ->get(['id', 'title']);

        if ($overdue->isEmpty() && $unassigned->isEmpty() && $fromChats->isEmpty()) {
            return null;
        }

        $lines = ['*Your projects this morning*'];

        if ($overdue->isNotEmpty()) {
            $lines[] = '';
            $lines[] = 'Overdue:';
            foreach ($overdue as $task) {
                $owner = $task->assignee_user_id ? User::query()->find($task->assignee_user_id) : null;
                $lines[] = sprintf(
                    '• #%d %s — %s%s',
                    (int) $task->id,
                    (string) $task->title,
                    Carbon::parse($task->due_date)->format('j M'),
                    $owner ? ', '.trim($owner->first_name.' '.$owner->last_name) : ', nobody on it',
                );
            }
        }

        if ($unassigned->isNotEmpty()) {
            $lines[] = '';
            $lines[] = 'Nobody assigned:';
            foreach ($unassigned as $task) {
                $lines[] = sprintf('• #%d %s', (int) $task->id, (string) $task->title);
            }
        }

        if ($fromChats->isNotEmpty()) {
            $lines[] = '';
            $lines[] = 'Raised from WhatsApp in the last day:';
            foreach ($fromChats as $task) {
                $lines[] = sprintf('• #%d %s', (int) $task->id, (string) $task->title);
            }
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
