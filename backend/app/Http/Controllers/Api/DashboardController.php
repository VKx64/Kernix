<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\Client;
use App\Models\FieldValue;
use App\Models\Task;
use App\Models\TimeEntry;
use App\Support\SingleClient;
use App\Support\TaskSignals;
use App\Support\UserSettings;
use Carbon\Carbon;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;

/**
 * The employee's own "what do I work on right now" screen. Everything here is
 * scoped to the requesting user's assigned work and their own tracked time;
 * there are deliberately no studio-wide totals, because an employee cannot act
 * on them. Retainer is the one cross-user number, and it is an allowance of
 * minutes rather than money.
 */
class DashboardController extends ApiController
{
    private const FOCUS_LIMIT = 5;

    private const ATTENTION_LIMIT = 6;

    private const UPCOMING_DAYS = 14;

    private const ACTIVITY_LIMIT = 10;

    /** @var array<string, string> */
    private const ACTIVITY_VERBS = [
        'task.create' => 'created',
        'task.update' => 'updated',
        'task.archive' => 'archived',
        'task.restore' => 'restored',
        'task.delete' => 'deleted',
        'task.note.create' => 'commented on',
        'task.note.update' => 'edited a comment on',
        'task.note.delete' => 'deleted a comment on',
        'task.message.start' => 'sent a message about',
        'task.message.reply' => 'replied about',
        'task.subtask.create' => 'added a subtask to',
        'task.subtask.update' => 'updated a subtask on',
        'task.subtask.complete' => 'completed a subtask on',
        'task.subtask.delete' => 'removed a subtask from',
        'task.attachment.create' => 'attached a file to',
        'task.attachment.delete' => 'removed a file from',
        'task.completion_proof.submit' => 'submitted completion proof for',
        'task.estimate_request.create' => 'requested an estimate on',
        'task.estimate_request.approve' => 'approved the estimate on',
        'task.estimate_request.reject' => 'rejected the estimate on',
        'task.estimate_request.override' => 'overrode the estimate on',
        'task.work_request.create' => 'asked to work on',
        'task.work_request.withdraw' => 'withdrew a work request on',
        'task.email.send' => 'emailed the client about',
        'task.email.delete' => 'deleted an email on',
    ];

    public function __invoke(Request $request): JsonResponse
    {
        $this->permission($request, 'dashboard.view');
        $validated = $request->validate(['range' => ['sometimes', Rule::in(['today', 'week'])]]);
        $range = $validated['range'] ?? 'today';

        $user = $request->user();
        // The dashed target line on the week chart, and the note under today's
        // total, are whatever this person set their day to be.
        $dailyTarget = (int) UserSettings::for($user)['daily_target_minutes'];
        $now = Carbon::now();
        $today = $now->copy()->startOfDay();

        $mine = $this->myTasks((int) $user->id);
        $overdue = $mine->filter(fn (Task $task) => $this->isOverdue($task, $today))->values();
        $dueToday = $mine->filter(fn (Task $task) => $task->due_date?->isSameDay($today) === true)->values();
        $dueWeek = $mine->filter(fn (Task $task) => $task->due_date
            && $task->due_date->gte($today)
            && $task->due_date->lte($today->copy()->addDays(6)))->values();

        $weekStart = $now->copy()->startOfWeek(CarbonInterface::MONDAY);
        $myEntries = $this->entriesOverlapping(
            TimeEntry::query()->where('user_id', $user->id),
            $weekStart->copy()->subWeek(),
            $weekStart->copy()->addWeek(),
        );
        $week = $this->week($myEntries, $weekStart, $today, $now);
        $trackedToday = $this->minutes($myEntries, $today, $today->copy()->addDay(), 'work', $now);
        $retainer = $this->retainer($now);

        return $this->data([
            'range' => $range,
            'date' => $today->toDateString(),
            'greeting_name' => $user->first_name ?: $user->username,
            'metrics' => [
                'due_today' => [
                    'count' => $dueToday->count(),
                    'note' => $this->notStartedNote($dueToday),
                ],
                'overdue' => [
                    'count' => $overdue->count(),
                    'note' => $this->oldestOverdueNote($overdue, $today),
                ],
                'tracked_today' => [
                    'minutes' => $trackedToday,
                    'note' => 'of '.$this->hoursLabel($dailyTarget).' target',
                ],
                'retainer_burn' => $retainer === null ? null : [
                    'percent' => $retainer['capacity_minutes'] > 0
                        ? (int) round($retainer['used_minutes'] / $retainer['capacity_minutes'] * 100)
                        : 0,
                    'note' => 'across '.count($retainer['clients']).' '.(count($retainer['clients']) === 1 ? 'client' : 'clients'),
                ],
            ],
            'focus' => $this->focus($mine, $range === 'week' ? $overdue->merge($dueWeek) : $overdue->merge($dueToday), $today),
            'needs_attention' => $this->needsAttention($mine, $today),
            'upcoming' => $this->upcoming($mine, $today),
            'week' => $week,
            'week_total_minutes' => array_sum(array_column($week, 'work_minutes')),
            'last_week_total_minutes' => $this->minutes($myEntries, $weekStart->copy()->subWeek(), $weekStart, 'work', $now),
            'daily_target_minutes' => $dailyTarget,
            'retainer' => $retainer,
            'activity' => $this->activity((int) $user->id, $now),
        ]);
    }

    /**
     * "Mine" for every list on this screen: assigned to me, not done, not
     * archived. Small enough to derive in PHP, which keeps the dashboard and
     * the Triage screen from drifting apart over separate SQL.
     *
     * @return Collection<int, Task>
     */
    private function myTasks(int $userId): Collection
    {
        $query = Task::query()
            ->with(['project.client', 'status', 'urgency'])
            ->where('assignee_user_id', $userId)
            ->whereNull('archived_at')
            ->whereNotIn('status_value_id', TaskSignals::statusValueIdsForRoles(['done']));
        $this->scopeToClient($query);

        return $query->orderBy('id')->get();
    }

    private function scopeToClient(Builder $query): void
    {
        if (SingleClient::enabled()) {
            $query->whereHas('project', fn ($project) => $project->where('client_id', SingleClient::id() ?? 0));
        }
    }

    private function isOverdue(Task $task, Carbon $today): bool
    {
        return $task->due_date !== null && $task->due_date->lt($today);
    }

    /** @param Collection<int, Task> $dueToday */
    private function notStartedNote(Collection $dueToday): string
    {
        $count = $dueToday->filter(fn (Task $task) => $this->role($task) === 'open')->count();

        return $count > 0 ? "{$count} not started" : '';
    }

    /** @param Collection<int, Task> $overdue */
    private function oldestOverdueNote(Collection $overdue, Carbon $today): string
    {
        $oldest = $overdue->min(fn (Task $task) => $task->due_date->getTimestamp());
        if ($oldest === null) {
            return '';
        }
        $days = (int) Carbon::createFromTimestamp($oldest, $today->getTimezone())->startOfDay()->diffInDays($today);

        return 'oldest '.$days.' '.($days === 1 ? 'day' : 'days').' late';
    }

    /**
     * The ranked "work on next" list. Overdue outweighs urgency, urgency
     * outweighs everything else, and something already in progress edges ahead
     * of an equally urgent task nobody has touched.
     *
     * @param  Collection<int, Task>  $mine
     * @param  Collection<int, Task>  $scope
     * @return array<int, array<string, mixed>>
     */
    private function focus(Collection $mine, Collection $scope, Carbon $today): array
    {
        $ranked = $scope->unique('id')->values()->sort(function (Task $a, Task $b) use ($today) {
            return [$this->focusKey($a, $today), $this->dueSort($a), $a->id]
                <=> [$this->focusKey($b, $today), $this->dueSort($b), $b->id];
        })->values();

        // Anything outside the scope still fills the list rather than leaving a
        // half-empty panel; it just sorts behind everything that qualified.
        if ($ranked->count() < self::FOCUS_LIMIT) {
            $rest = $mine->whereNotIn('id', $ranked->pluck('id')->all())
                ->sort(fn (Task $a, Task $b) => [$this->dueSort($a), $a->id] <=> [$this->dueSort($b), $b->id])
                ->take(self::FOCUS_LIMIT - $ranked->count());
            $ranked = $ranked->concat($rest);
        }

        return $ranked->take(self::FOCUS_LIMIT)->values()
            ->map(fn (Task $task, int $index) => [
                'rank' => $index + 1,
                'id' => $task->id,
                'title' => $task->title,
                'project' => $task->project?->name,
                'client' => $task->project?->client?->name,
                'status' => $this->statusPayload($task->status),
                'urgency' => $this->urgencyPayload($task->urgency),
                'due_date' => $task->due_date?->toDateString(),
                'logged_minutes' => (int) $task->actual_minutes,
                'overdue' => $this->isOverdue($task, $today),
            ])->all();
    }

    private function focusKey(Task $task, Carbon $today): float
    {
        return ($this->isOverdue($task, $today) ? 0 : 1) * 10
            + TaskSignals::urgencyRank($task->urgency?->key_name)
            + ($this->role($task) === 'active' ? -0.5 : 0);
    }

    /** A task with no due date sorts last rather than first. */
    private function dueSort(Task $task): int
    {
        return $task->due_date?->getTimestamp() ?? PHP_INT_MAX;
    }

    /**
     * @param  Collection<int, Task>  $mine
     * @return array<int, array<string, mixed>>
     */
    private function needsAttention(Collection $mine, Carbon $today): array
    {
        $items = [];
        foreach ($mine as $task) {
            [$reason, $why] = $this->attentionReason($task, $today);
            if ($reason === null) {
                continue;
            }
            $items[] = [
                'priority' => array_search($reason, ['blocked', 'overdue', 'not_started'], true),
                'due' => $this->dueSort($task),
                'payload' => [
                    'id' => $task->id,
                    'title' => $task->title,
                    'project' => $task->project?->name,
                    'why' => $why,
                    'reason' => $reason,
                    'status' => $this->statusPayload($task->status),
                    'urgency' => $this->urgencyPayload($task->urgency),
                    'due_date' => $task->due_date?->toDateString(),
                ],
            ];
        }

        usort($items, fn (array $a, array $b) => [$a['priority'], $a['due']] <=> [$b['priority'], $b['due']]);

        return array_column(array_slice($items, 0, self::ATTENTION_LIMIT), 'payload');
    }

    /** @return array{0: ?string, 1: ?string} */
    private function attentionReason(Task $task, Carbon $today): array
    {
        if ($this->role($task) === 'blocked') {
            // No status-change history exists yet, so the last edit stands in
            // for "blocked since"; it is the closest signal the schema carries.
            $days = (int) $task->updated_at?->copy()->startOfDay()->diffInDays($today);

            return ['blocked', $days > 0 ? 'Blocked for '.$days.' '.($days === 1 ? 'day' : 'days') : 'Blocked today'];
        }
        if ($this->isOverdue($task, $today)) {
            $days = (int) $task->due_date->copy()->startOfDay()->diffInDays($today);

            return ['overdue', $days.' '.($days === 1 ? 'day' : 'days').' late'];
        }
        if ($task->due_date?->isSameDay($today) && $this->role($task) === 'open') {
            return ['not_started', 'Due today, not started'];
        }

        return [null, null];
    }

    /**
     * @param  Collection<int, Task>  $mine
     * @return array<int, array<string, mixed>>
     */
    private function upcoming(Collection $mine, Carbon $today): array
    {
        $limit = $today->copy()->addDays(self::UPCOMING_DAYS);

        return $mine
            ->filter(fn (Task $task) => $task->due_date && $task->due_date->gte($today) && $task->due_date->lte($limit))
            ->groupBy(fn (Task $task) => $task->due_date->toDateString())
            ->sortKeys()
            ->map(fn (Collection $tasks, string $date) => [
                'date' => $date,
                'label' => $this->dayLabel(Carbon::parse($date), $today),
                'tasks' => $tasks->sortBy('id')->values()->map(fn (Task $task) => [
                    'id' => $task->id,
                    'title' => $task->title,
                    'project' => $task->project?->name,
                    'status' => $this->statusPayload($task->status),
                    'urgency' => $this->urgencyPayload($task->urgency),
                ])->all(),
            ])->values()->all();
    }

    private function dayLabel(Carbon $date, Carbon $today): string
    {
        return match ((int) $today->diffInDays($date, false)) {
            0 => 'Today',
            1 => 'Tomorrow',
            default => $date->format('D j M'),
        };
    }

    /**
     * @param  Collection<int, TimeEntry>  $entries
     * @return array<int, array<string, mixed>>
     */
    private function week(Collection $entries, Carbon $weekStart, Carbon $today, Carbon $now): array
    {
        $days = [];
        for ($day = 0; $day < 7; $day++) {
            $start = $weekStart->copy()->addDays($day);
            $end = $start->copy()->addDay();
            $days[] = [
                'date' => $start->toDateString(),
                'label' => $start->format('D'),
                'work_minutes' => $this->minutes($entries, $start, $end, 'work', $now),
                'break_minutes' => $this->minutes($entries, $start, $end, 'break', $now),
                'is_today' => $start->isSameDay($today),
            ];
        }

        return $days;
    }

    /**
     * Clients with an allowance, the month's burn against it, and where the
     * month is heading. Null when nobody is on a retainer at all.
     *
     * @return array<string, mixed>|null
     */
    private function retainer(Carbon $now): ?array
    {
        $query = Client::query()->whereNotNull('retainer_minutes')->whereNull('archived_at')->where('is_default', false);
        if (SingleClient::enabled()) {
            $query->whereKey(SingleClient::id() ?? 0);
        }
        $clients = $query->orderBy('id')->get();
        if ($clients->isEmpty()) {
            return null;
        }

        $monthStart = $now->copy()->startOfMonth();
        $entries = $this->clientWorkEntries($clients->pluck('id')->all(), $monthStart, $now);

        $running = 0;
        $series = [];
        for ($day = 1; $day <= $now->day; $day++) {
            $start = $monthStart->copy()->addDays($day - 1);
            $running += $this->seconds($entries, $start, $start->copy()->addDay(), 'work', $now);
            $series[] = ['day' => $day, 'used_minutes' => (int) round($running / 60)];
        }
        $used = (int) round($running / 60);
        $elapsed = $this->weekdays($monthStart, $now);
        $total = $this->weekdays($monthStart, $now->copy()->endOfMonth());

        $perClient = $clients->map(fn (Client $client) => [
            'id' => $client->id,
            'name' => $client->name,
            'used_minutes' => $this->minutes(
                $entries->where('client_id', $client->id),
                $monthStart,
                $now,
                'work',
                $now,
            ),
            'retainer_minutes' => (int) $client->retainer_minutes,
        ])->sortByDesc(fn (array $row) => $row['retainer_minutes'] > 0
            ? $row['used_minutes'] / $row['retainer_minutes']
            : 0)->values()->all();

        return [
            'month_label' => $now->format('F'),
            'capacity_minutes' => (int) $clients->sum('retainer_minutes'),
            'used_minutes' => $used,
            'projected_minutes' => $elapsed > 0 ? (int) round($used * $total / $elapsed) : $used,
            'day_of_month' => $now->day,
            'days_in_month' => $now->daysInMonth,
            'series' => $series,
            'clients' => $perClient,
        ];
    }

    /**
     * Work logged by anyone against a retainer client's tasks. The client id
     * rides along on each row so the per-client split needs no second query.
     *
     * @param  array<int, int>  $clientIds
     * @return Collection<int, TimeEntry>
     */
    private function clientWorkEntries(array $clientIds, Carbon $from, Carbon $to): Collection
    {
        return $this->entriesOverlapping(
            TimeEntry::query()
                ->join('tasks', 'tasks.id', '=', 'time_entries.task_id')
                ->join('projects', 'projects.id', '=', 'tasks.project_id')
                ->whereNull('tasks.deleted_at')
                ->whereNull('projects.deleted_at')
                ->whereIn('projects.client_id', $clientIds)
                ->where('time_entries.kind', 'work')
                ->select('time_entries.*', 'projects.client_id as client_id'),
            $from,
            $to,
        );
    }

    /**
     * Every entry overlapping the window, including one still running.
     *
     * @return Collection<int, TimeEntry>
     */
    private function entriesOverlapping(Builder $query, Carbon $from, Carbon $to): Collection
    {
        return $query
            ->where('time_entries.started_at', '<', $to)
            ->where(fn ($inner) => $inner
                ->whereNull('time_entries.ended_at')
                ->orWhere('time_entries.ended_at', '>', $from))
            ->orderBy('time_entries.started_at')
            ->get();
    }

    /** @param Collection<int, TimeEntry> $entries */
    private function minutes(Collection $entries, Carbon $from, Carbon $to, string $kind, Carbon $now): int
    {
        return (int) round($this->seconds($entries, $from, $to, $kind, $now) / 60);
    }

    /** @param Collection<int, TimeEntry> $entries */
    private function seconds(Collection $entries, Carbon $from, Carbon $to, string $kind, Carbon $now): int
    {
        $seconds = 0;
        foreach ($entries as $entry) {
            if (($entry->kind === 'break' ? 'break' : 'work') !== $kind) {
                continue;
            }
            // A running entry counts up to now, so today's bar keeps moving.
            $end = $entry->ended_at ?? $now;
            $begin = $entry->started_at->gt($from) ? $entry->started_at : $from;
            $finish = $end->lt($to) ? $end : $to;
            $seconds += max(0, $finish->getTimestamp() - $begin->getTimestamp());
        }

        return $seconds;
    }

    /** Inclusive of both ends; used to extrapolate the retainer month. */
    private function weekdays(Carbon $from, Carbon $to): int
    {
        $count = 0;
        for ($day = $from->copy()->startOfDay(); $day->lte($to); $day->addDay()) {
            if ($day->isWeekday()) {
                $count++;
            }
        }

        return $count;
    }

    /**
     * What other people did to the user's work. Their own actions are excluded:
     * narrating someone's clicks back at them is not news.
     *
     * @return array<int, array<string, mixed>>
     */
    private function activity(int $userId, Carbon $now): array
    {
        $taskQuery = Task::query()->where(fn ($query) => $query
            ->where('assignee_user_id', $userId)
            ->orWhere('created_by', $userId));
        $this->scopeToClient($taskQuery);
        $titles = $taskQuery->pluck('title', 'id');
        if ($titles->isEmpty()) {
            return [];
        }

        return AuditLog::query()
            ->with('user:id,first_name,last_name')
            ->where('entity_type', 'Task')
            ->whereIn('entity_id', $titles->keys()->all())
            ->whereNotNull('user_id')
            ->where('user_id', '!=', $userId)
            ->latest('id')
            ->limit(self::ACTIVITY_LIMIT)
            ->get()
            ->filter(fn (AuditLog $log) => $log->user !== null)
            ->map(fn (AuditLog $log) => [
                'id' => $log->id,
                'user' => [
                    'id' => $log->user->id,
                    'first_name' => $log->user->first_name,
                    'last_name' => $log->user->last_name,
                ],
                'text' => trim($log->user->first_name.' '
                    .(self::ACTIVITY_VERBS[$log->action] ?? 'updated').' '
                    .$titles[(int) $log->entity_id]),
                'at' => ($log->created_at ?? $now)->toIso8601String(),
            ])->values()->all();
    }

    private function role(Task $task): string
    {
        return TaskSignals::statusRole($task->status?->key_name);
    }

    /** @return array<string, mixed> */
    private function statusPayload(?FieldValue $value): array
    {
        return ['label' => $value?->label, 'role' => TaskSignals::statusRole($value?->key_name)];
    }

    /** @return array<string, mixed> */
    private function urgencyPayload(?FieldValue $value): array
    {
        return ['label' => $value?->label, 'rank' => TaskSignals::urgencyRank($value?->key_name)];
    }

    private function hoursLabel(int $minutes): string
    {
        $hours = $minutes / 60;

        return ($hours == (int) $hours ? (string) (int) $hours : rtrim(rtrim(number_format($hours, 1), '0'), '.')).'h';
    }
}
