<?php

namespace App\Services;

use App\Models\Task;
use App\Models\TimeEntry;
use App\Models\TimesheetDescription;
use App\Models\User;
use App\Support\PastTense;
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
        $buckets = $this->seconds($user, $period['start'], $period['end']->copy()->addDay());

        // An untargeted timer cannot be attributed to a client, so it is
        // reported rather than hidden: the screen admits the time exists.
        $unassigned = $this->minutes($buckets[0] ?? []);
        unset($buckets[0]);

        $tasks = Task::withTrashed()
            ->with('project.client')
            ->whereIn('id', array_keys($buckets))
            ->get()
            ->keyBy('id');
        $overrides = $this->overrides($user, array_keys($buckets), $period['start'], $period['end']);

        $lanes = [];
        foreach ($buckets as $taskId => $days) {
            $task = $tasks->get($taskId);
            if (! $task) {
                // Time on a task this workspace cannot see. It still happened,
                // so it is admitted as unattributed rather than dropped.
                $unassigned += $this->minutes($days);

                continue;
            }

            foreach ($days as $date => $seconds) {
                $minutes = (int) round($seconds / 60);
                if ($minutes < 1) {
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
                $lanes[$key]['minutes'] += $minutes;
                $lanes[$key]['entry_count']++;
                $lanes[$key]['rows'][] = $this->row(
                    $task,
                    $date,
                    $minutes,
                    $overrides[$taskId.'|'.$date] ?? null,
                );
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
     * they tracked no time there, which is the only ground for refusing.
     *
     * @return array<string, mixed>|null
     */
    public function describe(User $user, int $taskId, string $date, string $body): ?array
    {
        $day = Carbon::parse($date)->startOfDay();
        $buckets = $this->seconds($user, $day, $day->copy()->addDay());
        $minutes = (int) round(($buckets[$taskId][$day->toDateString()] ?? 0) / 60);
        $task = Task::withTrashed()->with('project.client')->find($taskId);
        if ($minutes < 1 || ! $task) {
            return null;
        }

        $keys = ['user_id' => $user->id, 'task_id' => $taskId, 'work_date' => $day->toDateString()];
        $override = $body === PastTense::describe($task->title) ? null : $body;
        if ($override === null) {
            // Storing the generated text would freeze a line that should keep
            // following the task title, so agreeing with it clears the override.
            TimesheetDescription::query()->where($keys)->delete();
        } else {
            TimesheetDescription::query()->updateOrCreate($keys, ['body' => $override]);
        }

        return $this->row($task, $day->toDateString(), $minutes, $override);
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
                $row->task_id.'|'.$row->work_date => $row->body,
            ])
            ->all();
    }

    /** @return array<string, mixed> */
    private function row(Task $task, string $date, int $minutes, ?string $override): array
    {
        $generated = PastTense::describe($task->title);

        return [
            'task_id' => (int) $task->id,
            'date' => $date,
            'description' => $override ?? $generated,
            'generated' => $generated,
            'edited' => $override !== null,
            'minutes' => $minutes,
            'hours' => round($minutes / 60, 2),
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
