<?php

namespace App\Services;

use App\Models\AuditLog;
use App\Models\Client;
use App\Models\Task;
use App\Models\TimeEntry;
use App\Models\User;
use App\Support\SingleClient;
use App\Support\TaskSignals;
use App\Support\UserSettings;
use Carbon\Carbon;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

/**
 * The read-only half of Oliver: what it can tell someone about their own work
 * without changing anything. Everything here is scoped to the signed-in
 * employee, because this is an employee portal and a colleague's numbers are
 * not this person's business. Retainer is the one shared figure, and it is an
 * allowance of minutes rather than money.
 *
 * The retainer window and arithmetic deliberately match the dashboard's, so
 * Oliver and the dashboard cannot report different burns for the same month.
 */
class OliverInsights
{
    private const WEEKDAYS_PER_WEEK = 5;

    private const RISK_LIMIT = 6;

    private const GAP_DAYS = 7;

    /** @return array<string, mixed> */
    public function for(User $user): array
    {
        $now = Carbon::now();
        $today = $now->copy()->startOfDay();
        $mine = $this->myTasks((int) $user->id);

        return [
            'watching' => $this->watching($mine),
            'risk' => $this->risk($mine, $today),
            'workload' => $this->workload($user, $mine, $now, $today),
            'retainer' => $this->retainer($now),
            'time_gaps' => $this->timeGaps($user, $now, $today),
        ];
    }

    /**
     * "Mine" everywhere on this screen: assigned to me, not done, not archived.
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

    /**
     * @param  Collection<int, Task>  $mine
     * @return array<string, int>
     */
    private function watching(Collection $mine): array
    {
        return [
            'projects' => $mine->pluck('project_id')->filter()->unique()->count(),
            'tasks' => $mine->count(),
            'clients' => $mine->map(fn (Task $task) => $task->project?->client_id)->filter()->unique()->count(),
        ];
    }

    /**
     * Blocked outranks late, late outranks untouched, and within a reason the
     * nearest due date comes first. Phrased exactly as the dashboard phrases it.
     *
     * @param  Collection<int, Task>  $mine
     * @return array<int, array<string, mixed>>
     */
    private function risk(Collection $mine, Carbon $today): array
    {
        $rows = [];
        foreach ($mine as $task) {
            [$reason, $why, $severity] = $this->riskReason($task, $today);
            if ($reason === null) {
                continue;
            }
            $rows[] = [
                'priority' => array_search($reason, ['blocked', 'overdue', 'not_started'], true),
                'due' => $task->due_date?->getTimestamp() ?? PHP_INT_MAX,
                'payload' => [
                    'task_id' => (int) $task->id,
                    'title' => $task->title,
                    'reason' => $reason,
                    'why' => $why,
                    'severity' => $severity,
                ],
            ];
        }

        usort($rows, fn (array $a, array $b) => [$a['priority'], $a['due']] <=> [$b['priority'], $b['due']]);

        return array_column(array_slice($rows, 0, self::RISK_LIMIT), 'payload');
    }

    /** @return array{0: ?string, 1: ?string, 2: ?string} */
    private function riskReason(Task $task, Carbon $today): array
    {
        if (TaskSignals::statusRole($task->status?->key_name) === 'blocked') {
            // No status-change history exists yet, so the last edit stands in
            // for "blocked since"; it is the closest signal the schema carries.
            $days = (int) $task->updated_at?->copy()->startOfDay()->diffInDays($today);

            return ['blocked', $days > 0 ? 'Blocked for '.$this->days($days) : 'Blocked today', 'high'];
        }
        if ($task->due_date !== null && $task->due_date->lt($today)) {
            $days = (int) $task->due_date->copy()->startOfDay()->diffInDays($today);

            return ['overdue', $this->days($days).' late', 'high'];
        }
        if ($task->due_date?->isSameDay($today) && TaskSignals::statusRole($task->status?->key_name) === 'open') {
            return ['not_started', 'Due today, not started', 'medium'];
        }

        return [null, null, null];
    }

    /**
     * What is on this person's plate, and whether the coming week already asks
     * for more hours than the week has.
     *
     * @param  Collection<int, Task>  $mine
     * @return array<string, mixed>
     */
    private function workload(User $user, Collection $mine, Carbon $now, Carbon $today): array
    {
        $weekStart = $now->copy()->startOfWeek(CarbonInterface::MONDAY);
        $tracked = $this->minutes(
            $this->myWorkEntries($user, $weekStart, $weekStart->copy()->addWeek()),
            $weekStart,
            $now,
            $now,
        );

        $window = $today->copy()->addDays(6);
        $committed = (int) $mine
            ->filter(fn (Task $task) => $task->due_date && $task->due_date->gte($today) && $task->due_date->lte($window))
            ->sum('estimated_minutes');
        // The week this person says they work, not a week this service assumes.
        $weekTarget = (int) UserSettings::for($user)['weekly_target_minutes'];
        // The window is measured against the working days still left in it, not
        // against a whole week, so a Friday question is not judged on Monday's
        // capacity.
        $remainingTarget = $this->weekdays($today, $window) * intdiv($weekTarget, self::WEEKDAYS_PER_WEEK);

        return [
            'open' => $mine->count(),
            'overdue' => $mine->filter(fn (Task $task) => $task->due_date !== null && $task->due_date->lt($today))->count(),
            'tracked_week_minutes' => $tracked,
            'target_week_minutes' => $weekTarget,
            'committed_minutes' => $committed,
            'over_committed' => $committed > $remainingTarget,
        ];
    }

    /**
     * Clients with an allowance, this month's burn against it, and where the
     * month is heading. Empty when nobody is on a retainer at all.
     *
     * @return array<int, array<string, mixed>>
     */
    private function retainer(Carbon $now): array
    {
        $query = Client::query()->whereNotNull('retainer_minutes')->whereNull('archived_at');
        if (SingleClient::enabled()) {
            $query->whereKey(SingleClient::id() ?? 0);
        }
        $clients = $query->orderBy('id')->get();
        if ($clients->isEmpty()) {
            return [];
        }

        $monthStart = $now->copy()->startOfMonth();
        $entries = $this->clientWorkEntries($clients->pluck('id')->all(), $monthStart, $now);
        $elapsed = $this->weekdays($monthStart, $now);
        $total = $this->weekdays($monthStart, $now->copy()->endOfMonth());

        return $clients->map(function (Client $client) use ($entries, $monthStart, $now, $elapsed, $total) {
            $used = $this->minutes($entries->where('client_id', $client->id), $monthStart, $now, $now);
            $allowance = (int) $client->retainer_minutes;
            $projected = $elapsed > 0 ? (int) round($used * $total / $elapsed) : $used;

            return [
                'client_id' => (int) $client->id,
                'name' => $client->name,
                'used_minutes' => $used,
                'retainer_minutes' => $allowance,
                'percent' => $allowance > 0 ? (int) round($used / $allowance * 100) : 0,
                'projected_minutes' => $projected,
                'over' => $projected > $allowance,
            ];
        })->sortByDesc(fn (array $row) => $row['retainer_minutes'] > 0
            ? $row['used_minutes'] / $row['retainer_minutes']
            : 0)->values()->all();
    }

    /**
     * Days this person worked on something but barely tracked it. This points
     * at the requester's own record and nobody else's: a time-fidelity nudge
     * aimed at a colleague would be surveillance.
     *
     * @return array<int, array<string, mixed>>
     */
    private function timeGaps(User $user, Carbon $now, Carbon $today): array
    {
        // A gap is measured against the day this person actually works, not a
        // fixed seven hours — otherwise someone on a six-hour day is nudged
        // about an hour they never owed.
        $dailyTarget = (int) UserSettings::for($user)['daily_target_minutes'];
        $from = $today->copy()->subDays(self::GAP_DAYS);
        $entries = $this->myWorkEntries($user, $from, $today);
        $touched = $this->daysTouched($user, $from, $today);

        $gaps = [];
        for ($day = $from->copy(); $day->lt($today); $day->addDay()) {
            $date = $day->toDateString();
            if (! $day->isWeekday() || ! in_array($date, $touched, true)) {
                continue;
            }
            $tracked = $this->minutes($entries, $day, $day->copy()->addDay(), $now);
            if ($tracked * 2 >= $dailyTarget) {
                continue;
            }
            $gaps[] = [
                'date' => $date,
                'tracked_minutes' => $tracked,
                'target_minutes' => $dailyTarget,
                'note' => $day->format('l').' has '.$this->duration($dailyTarget - $tracked).' unaccounted for',
            ];
        }

        return $gaps;
    }

    /**
     * The days the person left a mark on a task, from the audit trail, which is
     * the only record of work that does not depend on the timer being running.
     *
     * @return array<int, string>
     */
    private function daysTouched(User $user, Carbon $from, Carbon $to): array
    {
        return AuditLog::query()
            ->where('user_id', $user->id)
            ->where('entity_type', 'Task')
            ->where('created_at', '>=', $from)
            ->where('created_at', '<', $to)
            ->pluck('created_at')
            ->map(fn ($at) => Carbon::parse($at)->toDateString())
            ->unique()
            ->values()
            ->all();
    }

    /** @return Collection<int, TimeEntry> */
    private function myWorkEntries(User $user, Carbon $from, Carbon $to): Collection
    {
        return $this->entriesOverlapping(
            TimeEntry::query()->where('time_entries.user_id', $user->id)->where('time_entries.kind', 'work'),
            $from,
            $to,
        );
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
    private function minutes(Collection $entries, Carbon $from, Carbon $to, Carbon $now): int
    {
        $seconds = 0;
        foreach ($entries as $entry) {
            // A running entry counts up to now, so today's figure keeps moving.
            $end = $entry->ended_at ?? $now;
            $begin = $entry->started_at->gt($from) ? $entry->started_at : $from;
            $finish = $end->lt($to) ? $end : $to;
            $seconds += max(0, $finish->getTimestamp() - $begin->getTimestamp());
        }

        return (int) round($seconds / 60);
    }

    /** Inclusive of both ends; used to extrapolate a month and to size a window. */
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

    private function days(int $days): string
    {
        return $days.' '.($days === 1 ? 'day' : 'days');
    }

    private function duration(int $minutes): string
    {
        $hours = intdiv($minutes, 60);
        $rest = $minutes % 60;
        if ($hours === 0) {
            return $rest.'m';
        }

        return $rest === 0 ? $hours.'h' : $hours.'h '.$rest.'m';
    }
}
