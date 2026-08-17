<?php

namespace App\Services;

use App\Models\Task;
use App\Models\TaskNote;
use App\Models\TimeEntry;
use App\Models\TimesheetDescription;
use App\Models\User;
use App\Support\PastTense;
use App\Support\TaskSignals;
use Carbon\Carbon;

/**
 * The payroll timesheet: one row per task per local day, grouped by client.
 * It feeds the agency's spreadsheet rather than replacing it, so it carries
 * hours and nothing that resembles money, and every number traces back to a
 * closed work entry rather than being rounded to a billing increment.
 */
class TimesheetService
{
    public const CUTOFFS = ['semi', 'month'];

    /** A semi-monthly period is either the 1st-15th or the 16th-last. */
    private const SEMI_SPLIT_DAY = 15;

    /** @return array<string, mixed> */
    public function summary(User $user, string $cutoff, int $offset): array
    {
        $period = $this->period($cutoff, $offset);
        $end = $period['end']->copy()->addDay();
        $buckets = $this->seconds($user, $period['start'], $end);

        // An untargeted timer cannot be attributed to a client, so it is
        // reported rather than hidden: the screen admits the time exists.
        $unassigned = $this->minutes($buckets[0] ?? []);
        unset($buckets[0]);

        // Minutes typed against a task are work as much as minutes a timer
        // watched. They fed the analytics screen and nothing else, so anybody
        // who logs time by hand rather than running a timer had an empty
        // timesheet and no way to tell why.
        $days = $this->minutesByDay($buckets);
        foreach ($this->loggedMinutes($user, $period['start'], $end) as $taskId => $logged) {
            foreach ($logged as $date => $minutes) {
                $days[$taskId][$date] = ($days[$taskId][$date] ?? 0) + $minutes;
            }
        }

        // And the work itself, whether or not anybody counted it. A task
        // finished inside the period belongs on the timesheet even with no
        // time against it — with the hours left blank for the person to fill
        // in, rather than a zero that claims the job took nothing.
        foreach ($this->finishedWithoutTime($user, $period['start'], $end, $days) as $taskId => $date) {
            $days[$taskId][$date] = null;
        }

        $tasks = Task::withTrashed()
            ->with('project.client')
            ->whereIn('id', array_keys($days))
            ->get()
            ->keyBy('id');
        $overrides = $this->overrides($user, array_keys($days), $period['start'], $period['end']);

        $lanes = [];
        foreach ($days as $taskId => $dates) {
            $task = $tasks->get($taskId);
            if (! $task) {
                // Time on a task this workspace cannot see. It still happened,
                // so it is admitted as unattributed rather than dropped.
                $unassigned += array_sum(array_filter($dates, fn (?int $value) => $value !== null));

                continue;
            }

            foreach ($dates as $date => $minutes) {
                $override = $overrides[$taskId.'|'.$date] ?? null;
                $typed = $override['minutes'] ?? null;
                // Nothing tracked and nothing typed still earns a row; that is
                // the whole point. Only a tracked value under a minute is
                // dropped, which is a timer started and stopped by accident.
                if ($minutes !== null && $minutes < 1 && $typed === null) {
                    continue;
                }
                $client = $task->project?->client;
                $key = $client?->id ?? 0;
                $lanes[$key] ??= [
                    'client_id' => $client?->id,
                    'client' => $client?->name ?? 'No client',
                    'minutes' => 0,
                    'entry_count' => 0,
                    'rows' => [],
                ];
                $row = $this->row($task, $date, $minutes, $override['body'] ?? null, $typed);
                $lanes[$key]['minutes'] += $row['minutes'] ?? 0;
                $lanes[$key]['entry_count']++;
                $lanes[$key]['rows'][] = $row;
            }
        }

        foreach ($lanes as $key => $lane) {
            usort($lane['rows'], fn (array $a, array $b) => [$a['date'], $a['task_title']] <=> [$b['date'], $b['task_title']]);
            $lanes[$key]['rows'] = $lane['rows'];
        }
        // Biggest client first, except "No client", which is a leftover bin and
        // sorts last however much time landed in it.
        usort($lanes, fn (array $a, array $b) => [$a['client_id'] === null, -$a['minutes']]
            <=> [$b['client_id'] === null, -$b['minutes']]);

        $rows = $lanes === [] ? [] : array_merge(...array_column($lanes, 'rows'));

        return [
            'cutoff' => $cutoff,
            'offset' => $offset,
            'period' => [
                'start' => $period['start']->toDateString(),
                'end' => $period['end']->toDateString(),
                'label' => $period['label'],
            ],
            'total_minutes' => array_sum(array_column($lanes, 'minutes')),
            'entry_count' => count($rows),
            'days_worked' => count(array_unique(array_column($rows, 'date'))),
            'unassigned_minutes' => $unassigned,
            'lanes' => array_values($lanes),
        ];
    }

    /**
     * Stores, or clears, one person's line for one task on one day. Null means
     * the row does not exist for them, which is the only ground for refusing.
     *
     * @return array<string, mixed>|null
     */
    public function describe(User $user, int $taskId, string $date, string $body): ?array
    {
        $day = Carbon::parse($date)->startOfDay();
        $task = $this->rowTask($user, $taskId, $day);
        if (! $task) {
            return null;
        }

        $stored = $this->storedRow($user, $taskId, $day);
        $override = $body === PastTense::describe($task->title) ? null : $body;
        $this->store($user, $taskId, $day, $override, $stored?->minutes);

        return $this->row($task, $day->toDateString(), $this->trackedFor($user, $taskId, $day), $override, $stored?->minutes);
    }

    /**
     * The hours somebody types against a row the clock never saw.
     *
     * Null clears what they typed and puts the row back to blank, which is not
     * the same as typing zero — zero says the task took no billable time, and
     * on a payroll document that has to be somebody's statement rather than a
     * default.
     *
     * @return array<string, mixed>|null
     */
    public function setHours(User $user, int $taskId, string $date, ?int $minutes): ?array
    {
        $day = Carbon::parse($date)->startOfDay();
        $task = $this->rowTask($user, $taskId, $day);
        if (! $task) {
            return null;
        }

        $stored = $this->storedRow($user, $taskId, $day);
        $this->store($user, $taskId, $day, $stored?->body, $minutes);

        return $this->row($task, $day->toDateString(), $this->trackedFor($user, $taskId, $day), $stored?->body, $minutes);
    }

    /**
     * The task behind a row this person could edit — tracked time on the day,
     * or a task they were on that they finished that day. Anything else is not
     * their row to write on.
     */
    private function rowTask(User $user, int $taskId, Carbon $day): ?Task
    {
        $task = Task::withTrashed()->with('project.client')->find($taskId);
        if (! $task) {
            return null;
        }
        if ($this->trackedFor($user, $taskId, $day) !== null) {
            return $task;
        }

        $finished = $this->finishedWithoutTime($user, $day, $day->copy()->addDay(), []);

        return ($finished[$taskId] ?? null) === $day->toDateString() ? $task : null;
    }

    /** Timer seconds plus typed minutes for one task on one day, or null. */
    private function trackedFor(User $user, int $taskId, Carbon $day): ?int
    {
        $to = $day->copy()->addDay();
        $date = $day->toDateString();

        $seconds = $this->seconds($user, $day, $to)[$taskId][$date] ?? 0;
        $logged = $this->loggedMinutes($user, $day, $to)[$taskId][$date] ?? 0;
        $minutes = (int) round($seconds / 60) + $logged;

        return $minutes > 0 ? $minutes : null;
    }

    private function storedRow(User $user, int $taskId, Carbon $day): ?TimesheetDescription
    {
        return TimesheetDescription::query()
            ->where(['user_id' => $user->id, 'task_id' => $taskId, 'work_date' => $day->toDateString()])
            ->first();
    }

    /**
     * One place writes this table, so the description and the typed hours
     * cannot delete each other: the row goes only when both are empty.
     */
    private function store(User $user, int $taskId, Carbon $day, ?string $body, ?int $minutes): void
    {
        $keys = ['user_id' => $user->id, 'task_id' => $taskId, 'work_date' => $day->toDateString()];

        if ($body === null && $minutes === null) {
            // Storing the generated text would freeze a line that should keep
            // following the task title, so agreeing with it clears the override.
            TimesheetDescription::query()->where($keys)->delete();

            return;
        }

        TimesheetDescription::query()->updateOrCreate($keys, ['body' => $body, 'minutes' => $minutes]);
    }

    /**
     * The period containing today, walked `offset` periods from there.
     *
     * @return array{start: Carbon, end: Carbon, label: string}
     */
    public function period(string $cutoff, int $offset): array
    {
        $today = Carbon::today();

        if ($cutoff === 'month') {
            $start = $today->copy()->startOfMonth()->addMonthsNoOverflow($offset);
            $end = $start->copy()->endOfMonth()->startOfDay();

            return ['start' => $start, 'end' => $end, 'label' => $start->format('F Y')];
        }

        // Two periods a month, counted from year zero so the offset can cross
        // month and year boundaries with plain arithmetic.
        $index = $today->year * 24
            + ($today->month - 1) * 2
            + ($today->day > self::SEMI_SPLIT_DAY ? 1 : 0)
            + $offset;
        $year = intdiv($index, 24);
        $month = intdiv($index - $year * 24, 2) + 1;
        $second = ($index % 2) === 1;

        $start = Carbon::create($year, $month, $second ? self::SEMI_SPLIT_DAY + 1 : 1)->startOfDay();
        $end = $second
            ? $start->copy()->endOfMonth()->startOfDay()
            : $start->copy()->setDay(self::SEMI_SPLIT_DAY);

        return [
            'start' => $start,
            'end' => $end,
            'label' => $start->format('M j').' – '.$end->day.', '.$end->year,
        ];
    }

    /**
     * Closed work seconds, keyed by task then local date. Task 0 collects the
     * entries with no task at all.
     *
     * @return array<int, array<string, int>>
     */
    private function seconds(User $user, Carbon $from, Carbon $to): array
    {
        $entries = TimeEntry::query()
            ->where('user_id', $user->id)
            ->where('kind', 'work')
            ->whereNotNull('ended_at')
            ->where('started_at', '<', $to)
            ->where('ended_at', '>', $from)
            ->orderBy('started_at')
            ->get();

        $buckets = [];
        foreach ($entries as $entry) {
            // An entry that ran past midnight is split by real overlap, so each
            // local date carries only the time actually worked inside it.
            for ($day = $entry->started_at->copy()->startOfDay(); $day->lt($entry->ended_at) && $day->lt($to); $day->addDay()) {
                $next = $day->copy()->addDay();
                $seconds = $this->overlap(
                    $entry->started_at,
                    $entry->ended_at,
                    $day->gt($from) ? $day : $from,
                    $next->lt($to) ? $next : $to,
                );
                if ($seconds > 0) {
                    $key = (int) $entry->task_id;
                    $buckets[$key][$day->toDateString()] = ($buckets[$key][$day->toDateString()] ?? 0) + $seconds;
                }
            }
        }

        return $buckets;
    }

    /**
     * Seconds per task per day, rounded down to whole minutes.
     *
     * @param  array<int, array<string, int>>  $buckets
     * @return array<int, array<string, int>>
     */
    private function minutesByDay(array $buckets): array
    {
        $days = [];
        foreach ($buckets as $taskId => $dates) {
            foreach ($dates as $date => $seconds) {
                $days[$taskId][$date] = (int) round($seconds / 60);
            }
        }

        return $days;
    }

    /**
     * Minutes somebody entered by hand against a task, keyed by task then the
     * local date they entered them on.
     *
     * Credited to whoever the minutes belong to rather than whoever wrote the
     * note — the two differ wherever one person logs time on another's behalf,
     * and a timesheet has to follow the work.
     *
     * @return array<int, array<string, int>>
     */
    private function loggedMinutes(User $user, Carbon $from, Carbon $to): array
    {
        $notes = TaskNote::query()
            ->where('time_logged_by', $user->id)
            ->where('time_minutes', '>', 0)
            ->whereNotNull('task_id')
            ->where('created_at', '>=', $from)
            ->where('created_at', '<', $to)
            ->get(['task_id', 'time_minutes', 'created_at']);

        $days = [];
        foreach ($notes as $note) {
            $date = $note->created_at->toDateString();
            $days[(int) $note->task_id][$date] = ($days[(int) $note->task_id][$date] ?? 0) + (int) $note->time_minutes;
        }

        return $days;
    }

    /**
     * Tasks this person was on that were finished inside the period and carry
     * no time at all, keyed task id to the date they were finished.
     *
     * This is the answer to "I did the work, why is my timesheet empty". The
     * row appears with its hours blank; nothing here invents a number.
     *
     * @param  array<int, array<string, int|null>>  $already  Task days that already have a row.
     * @return array<int, string>
     */
    private function finishedWithoutTime(User $user, Carbon $from, Carbon $to, array $already): array
    {
        $tasks = Task::query()
            ->whereNotNull('completed_at')
            ->where('completed_at', '>=', $from)
            ->where('completed_at', '<', $to)
            ->whereIn('status_value_id', TaskSignals::statusValueIdsForRoles(['done']))
            ->where(fn ($query) => $query
                ->where('assignee_user_id', $user->id)
                ->orWhereHas('assignees', fn ($assignees) => $assignees->whereKey($user->id)))
            ->get(['id', 'completed_at']);

        $rows = [];
        foreach ($tasks as $task) {
            $taskId = (int) $task->id;
            // Somebody who tracked time on it already has their rows; a second
            // one dated on completion would double the same day's work.
            if (($already[$taskId] ?? []) !== []) {
                continue;
            }
            $rows[$taskId] = $task->completed_at->toDateString();
        }

        return $rows;
    }

    /**
     * @param  array<int, int>  $taskIds
     * @return array<string, string>
     */
    private function overrides(User $user, array $taskIds, Carbon $from, Carbon $to): array
    {
        if ($taskIds === []) {
            return [];
        }

        return TimesheetDescription::query()
            ->where('user_id', $user->id)
            ->whereIn('task_id', $taskIds)
            ->whereBetween('work_date', [$from->toDateString(), $to->toDateString()])
            ->get()
            ->mapWithKeys(fn (TimesheetDescription $row) => [
                $row->task_id.'|'.$row->work_date => [
                    'body' => $row->body,
                    'minutes' => $row->minutes === null ? null : (int) $row->minutes,
                ],
            ])
            ->all();
    }

    /**
     * @param  int|null  $tracked  Minutes the clock accounted for, or null.
     * @param  int|null  $typed  Minutes the person entered by hand, or null.
     * @return array<string, mixed>
     */
    private function row(Task $task, string $date, ?int $tracked, ?string $override, ?int $typed = null): array
    {
        $generated = PastTense::describe($task->title);
        // What somebody typed wins over what the clock saw. They were there;
        // the timer may have been left running through lunch or never started.
        $minutes = $typed ?? $tracked;

        return [
            'task_id' => (int) $task->id,
            'date' => $date,
            'description' => $override ?? $generated,
            'generated' => $generated,
            'edited' => $override !== null,
            'minutes' => $minutes,
            'hours' => $minutes === null ? null : round($minutes / 60, 2),
            'tracked_minutes' => $tracked,
            // Blank hours waiting for the person, rather than a claim of zero.
            'needs_hours' => $minutes === null,
            'typed' => $typed !== null,
            'task_title' => $task->title,
        ];
    }

    /** @param array<string, int> $days */
    private function minutes(array $days): int
    {
        return (int) round(array_sum($days) / 60);
    }

    private function overlap(Carbon $start, Carbon $end, Carbon $from, Carbon $to): int
    {
        $begin = $start->gt($from) ? $start : $from;
        $finish = $end->lt($to) ? $end : $to;

        return max(0, $finish->getTimestamp() - $begin->getTimestamp());
    }
}
