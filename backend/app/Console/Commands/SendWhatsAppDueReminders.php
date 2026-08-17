<?php

namespace App\Console\Commands;

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
 * "These are yours, and this one is due today."
 *
 * One message per person, listing what is overdue first and what is due today
 * second, because that is the order they have to deal with it in. Somebody with
 * nothing due hears nothing — a reminder that arrives every morning regardless is
 * one people stop reading inside a week.
 */
class SendWhatsAppDueReminders extends Command
{
    protected $signature = 'whatsapp:due-reminders
        {--dry-run : Print what would be sent without sending it}
        {--user= : Limit to one account id, for checking the wording}';

    protected $description = 'Tell each employee on WhatsApp what they have overdue and due today.';

    public function handle(WhatsAppNotifier $notifier): int
    {
        $sent = 0;

        foreach ($this->workspaces() as $workspaceId) {
            CurrentWorkspace::use($workspaceId, function () use ($notifier, &$sent) {
                foreach ($this->tasksByAssignee() as $userId => $tasks) {
                    $user = User::query()->where('status', 'active')->whereNull('archived_at')->find($userId);
                    if (! $user) {
                        continue;
                    }

                    $body = $this->message($user, $tasks);

                    if ($this->option('dry-run')) {
                        $this->line(sprintf('%s: %s', $user->username, str_replace("\n", ' / ', $body)));

                        continue;
                    }

                    try {
                        if ($notifier->notifyUser($user, $body)) {
                            $sent++;
                        }
                    } catch (Throwable $exception) {
                        report($exception);
                    }
                }
            });
        }

        $this->info($this->option('dry-run') ? 'Dry run complete.' : "Queued {$sent} due-date reminder(s).");

        return self::SUCCESS;
    }

    /**
     * Open tasks that are overdue or due today, grouped by the person they are
     * assigned to.
     *
     * @return Collection<int, Collection<int, Task>>
     */
    private function tasksByAssignee(): Collection
    {
        $only = (int) $this->option('user');

        return Task::query()
            ->whereNull('archived_at')
            ->whereNotNull('due_date')
            ->whereDate('due_date', '<=', today())
            ->whereNotNull('assignee_user_id')
            ->when($only > 0, fn ($query) => $query->where('assignee_user_id', $only))
            ->whereHas('status', fn ($status) => $status->where('key_name', '!=', 'complete'))
            ->orderBy('due_date')
            ->get(['id', 'title', 'due_date', 'assignee_user_id'])
            ->groupBy('assignee_user_id');
    }

    /**
     * @param  Collection<int, Task>  $tasks
     */
    private function message(User $user, Collection $tasks): string
    {
        $overdue = $tasks->filter(fn (Task $task) => Carbon::parse($task->due_date)->isBefore(today()));
        $today = $tasks->reject(fn (Task $task) => Carbon::parse($task->due_date)->isBefore(today()));

        $lines = ['Morning'.($user->first_name ? ', '.$user->first_name : '').'.'];

        if ($overdue->isNotEmpty()) {
            $lines[] = '';
            $lines[] = '*Overdue*';
            foreach ($overdue as $task) {
                $lines[] = sprintf(
                    '#%d — %s (was due %s)',
                    (int) $task->id,
                    (string) $task->title,
                    Carbon::parse($task->due_date)->format('D j M'),
                );
            }
        }

        if ($today->isNotEmpty()) {
            $lines[] = '';
            $lines[] = '*Due today*';
            foreach ($today as $task) {
                $lines[] = sprintf('#%d — %s', (int) $task->id, (string) $task->title);
            }
        }

        $lines[] = '';
        $lines[] = 'Send `start <id>` to put the timer on one, or `status` to see where you are.';

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
