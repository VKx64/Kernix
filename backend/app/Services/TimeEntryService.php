<?php

namespace App\Services;

use App\Models\Task;
use App\Models\TaskNote;
use App\Models\TimeEntry;
use App\Models\User;
use Carbon\Carbon;
use Carbon\CarbonInterface;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Per-task timers. These are distinct from `time_sessions`, which record
 * attendance for the day: one attendance session contains many entries.
 */
class TimeEntryService
{
    public const BREAK_KINDS = ['Short break', 'Coffee', 'Lunch', 'Meeting', 'Open-ended'];

    /** The day view renders 9am to 6pm; time outside folds into the edge buckets. */
    private const FIRST_HOUR = 9;

    private const LAST_HOUR = 18;

    public function __construct(private readonly TimeTrackingService $timeTracking) {}

    public function start(User $user, ?int $taskId = null): TimeEntry
    {
        // Starting a timer clocks you in: the product treats being at work and
        // working on something as one action rather than two.
        $session = $this->timeTracking->openSession($user) ?? $this->timeTracking->clockIn($user);
        // A timer start also ends any pause, so the attendance break cannot
        // outlive the timer break it was opened alongside.
        $this->timeTracking->ensureBreakEnded($user);

        return DB::transaction(function () use ($user, $session, $taskId) {
            $this->lock($user);
            $open = $this->openEntry($user, true);
            if ($open) {
                $this->closeEntry($open);
            }

            return $this->open($user, $session->id, $taskId, 'work');
        });
    }

    public function breakStart(User $user, string $kind, int $dueMinutes): TimeEntry
    {
        $entry = DB::transaction(function () use ($user, $kind, $dueMinutes) {
            $this->lock($user);
            $open = $this->openEntry($user, true);
            abort_unless($open && $open->kind === 'work', 409, 'Start the timer before taking a break.');
            $this->closeEntry($open);

            // The break carries the task so resuming knows where to return.
            return $this->open($user, $open->session_id, $open->task_id, 'break', $kind, $dueMinutes);
        });
        // The attendance break is what gates task edits while paused; the entry
        // above only carries the kind, the due minutes and the hour buckets.
        $this->timeTracking->ensureBreakStarted($user);

        return $entry;
    }

    public function resume(User $user): TimeEntry
    {
        $entry = DB::transaction(function () use ($user) {
            $this->lock($user);
            $open = $this->openEntry($user, true);
            abort_unless($open && $open->kind === 'break', 409, 'No break is in progress.');
            $this->closeEntry($open);

            return $this->open($user, $open->session_id, $open->task_id, 'work');
        });
        $this->timeTracking->ensureBreakEnded($user);

        return $entry;
    }

    public function stop(User $user): TimeEntry
    {
        $entry = DB::transaction(function () use ($user) {
            $this->lock($user);
            $open = $this->openEntry($user, true);
            abort_unless($open, 409, 'The timer is not running.');

            return $this->closeEntry($open);
        });
        if ($entry->kind === 'break') {
            // Stopping must never leave someone paused with no timer running.
            $this->timeTracking->ensureBreakEnded($user);
        }

        return $entry;
    }

    /** Used by clock-out, which must not leave an entry running past the session. */
    public function closeOpen(User $user): ?TimeEntry
    {
        $open = $this->openEntry($user, true);

        return $open ? $this->closeEntry($open) : null;
    }

    /** Minutes to report for a just-closed entry; a break logs nothing. */
    public function loggedMinutes(TimeEntry $entry): int
    {
        if ($entry->kind !== 'work') {
            return 0;
        }

        return max(1, (int) round($this->seconds($entry) / 60));
    }

    public function statusData(User $user): array
    {
        $now = Carbon::now();
        $open = $this->openEntry($user);
        $open?->loadMissing('task');
        $pausedTask = $open && $open->kind === 'break' ? $open->task : null;
        $weekStart = $now->copy()->startOfWeek(CarbonInterface::MONDAY);
        $entries = $this->entriesBetween($user, $weekStart, $weekStart->copy()->addWeek());

        return [
            'entry' => $this->entryPayload($open),
            'paused_task' => $this->taskPayload($pausedTask),
            'paused_seconds' => $pausedTask ? $this->pausedSeconds($user, $pausedTask->id) : 0,
            'clocked_in' => (bool) $this->timeTracking->openSession($user),
            'today' => $this->today($entries, $now),
            'week' => $this->week($entries, $weekStart, $now),
        ];
    }

    /**
     * Recomputed from scratch rather than incremented, so timer time and the
     * minutes logged by hand on notes reconcile instead of drifting apart.
     */
    public function reconcile(int $taskId): void
    {
        $task = Task::query()->lockForUpdate()->find($taskId);
        if (! $task) {
            return;
        }

        $seconds = TimeEntry::query()
            ->where('task_id', $taskId)
            ->where('kind', 'work')
            ->whereNotNull('ended_at')
            ->get()
            ->sum(fn (TimeEntry $entry) => $this->seconds($entry));
        $noteMinutes = (int) TaskNote::query()->where('task_id', $taskId)->sum('time_minutes');

        $task->update(['actual_minutes' => max(0, (int) round($seconds / 60) + $noteMinutes)]);
    }

    public function openEntry(User $user, bool $lock = false): ?TimeEntry
    {
        $query = TimeEntry::query()
            ->where('user_id', $user->id)
            ->whereNull('ended_at')
            ->latest('started_at');

        return $lock ? $query->lockForUpdate()->first() : $query->first();
    }

    /**
     * Work already banked on the paused task during this sitting, so the client
     * can show a running total the closed entry no longer carries.
     */
    private function pausedSeconds(User $user, int $taskId): int
    {
        $sessionId = $this->timeTracking->openSession($user)?->id;
        if (! $sessionId) {
            return 0;
        }

        return (int) TimeEntry::query()
            ->where('user_id', $user->id)
            ->where('session_id', $sessionId)
            ->where('task_id', $taskId)
            ->where('kind', 'work')
            ->whereNotNull('ended_at')
            ->get()
            ->sum(fn (TimeEntry $entry) => $this->seconds($entry));
    }

    private function open(
        User $user,
        ?int $sessionId,
        ?int $taskId,
        string $kind,
        ?string $breakKind = null,
        ?int $dueMinutes = null,
    ): TimeEntry {
        return TimeEntry::create([
            'user_id' => $user->id,
            'session_id' => $sessionId,
            'task_id' => $taskId,
            'kind' => $kind,
            'break_kind' => $breakKind,
            'break_due_minutes' => $dueMinutes,
            'started_at' => Carbon::now(),
        ]);
    }

    private function closeEntry(TimeEntry $entry): TimeEntry
    {
        $endedAt = Carbon::now();
        if ($endedAt->lt($entry->started_at)) {
            $endedAt = $entry->started_at->copy();
        }
        $entry->update(['ended_at' => $endedAt]);
        if ($entry->kind === 'work' && $entry->task_id) {
            $this->reconcile((int) $entry->task_id);
        }

        return $entry;
    }

    /**
     * The one-open-entry invariant is held by this lock rather than a partial
     * unique index, which is not portable across the supported databases.
     */
    private function lock(User $user): void
    {
        User::query()->whereKey($user->id)->lockForUpdate()->firstOrFail();
    }

    /**
     * Every entry overlapping the window, including one that started earlier and
     * is still running.
     *
     * @return Collection<int, TimeEntry>
     */
    private function entriesBetween(User $user, Carbon $from, Carbon $to): Collection
    {
        return TimeEntry::query()
            ->where('user_id', $user->id)
            ->where('started_at', '<', $to)
            ->where(fn ($query) => $query->whereNull('ended_at')->orWhere('ended_at', '>', $from))
            ->orderBy('started_at')
            ->get();
    }

    /** @param  Collection<int, TimeEntry>  $entries */
    private function today(Collection $entries, Carbon $now): array
    {
        $dayStart = $now->copy()->startOfDay();
        $buckets = [];
        for ($hour = self::FIRST_HOUR; $hour <= self::LAST_HOUR; $hour++) {
            $buckets[$hour] = ['hour' => $hour, 'work_minutes' => 0.0, 'break_minutes' => 0.0];
        }

        foreach ($entries as $entry) {
            $key = $entry->kind === 'break' ? 'break_minutes' : 'work_minutes';
            for ($hour = 0; $hour < 24; $hour++) {
                $seconds = $this->overlap(
                    $entry->started_at,
                    $this->end($entry, $now),
                    $dayStart->copy()->addHours($hour),
                    $dayStart->copy()->addHours($hour + 1),
                );
                if ($seconds <= 0) {
                    continue;
                }
                // An entry crossing an hour is split by real overlap, and time
                // outside the rendered window folds into the nearest edge.
                $bucket = min(max($hour, self::FIRST_HOUR), self::LAST_HOUR);
                $buckets[$bucket][$key] += $seconds / 60;
            }
        }

        $totals = $this->totals($entries, $dayStart, $dayStart->copy()->addDay(), $now);

        return [
            'work_minutes' => $totals['work_minutes'],
            'break_minutes' => $totals['break_minutes'],
            'hours' => array_values(array_map(fn (array $bucket) => [
                'hour' => $bucket['hour'],
                'work_minutes' => round($bucket['work_minutes'], 1),
                'break_minutes' => round($bucket['break_minutes'], 1),
            ], $buckets)),
        ];
    }

    /** @param  Collection<int, TimeEntry>  $entries */
    private function week(Collection $entries, Carbon $weekStart, Carbon $now): array
    {
        $days = [];
        for ($day = 0; $day < 7; $day++) {
            $dayStart = $weekStart->copy()->addDays($day);
            $days[] = ['date' => $dayStart->toDateString()]
                + $this->totals($entries, $dayStart, $dayStart->copy()->addDay(), $now);
        }

        return $days;
    }

    /** @param  Collection<int, TimeEntry>  $entries */
    private function totals(Collection $entries, Carbon $from, Carbon $to, Carbon $now): array
    {
        $seconds = ['work' => 0, 'break' => 0];
        foreach ($entries as $entry) {
            $key = $entry->kind === 'break' ? 'break' : 'work';
            $seconds[$key] += $this->overlap($entry->started_at, $this->end($entry, $now), $from, $to);
        }

        return [
            'work_minutes' => (int) round($seconds['work'] / 60),
            'break_minutes' => (int) round($seconds['break'] / 60),
        ];
    }

    private function overlap(Carbon $start, Carbon $end, Carbon $from, Carbon $to): int
    {
        $begin = $start->gt($from) ? $start : $from;
        $finish = $end->lt($to) ? $end : $to;

        return max(0, $finish->getTimestamp() - $begin->getTimestamp());
    }

    /** A running entry counts up to now. */
    private function end(TimeEntry $entry, ?Carbon $now = null): Carbon
    {
        return $entry->ended_at ?? ($now ?? Carbon::now());
    }

    private function seconds(TimeEntry $entry): int
    {
        return max(0, $this->end($entry)->getTimestamp() - $entry->started_at->getTimestamp());
    }

    private function entryPayload(?TimeEntry $entry): ?array
    {
        if (! $entry) {
            return null;
        }

        return [
            'id' => $entry->id,
            'task_id' => $entry->task_id,
            'task' => $this->taskPayload($entry->task),
            'kind' => $entry->kind,
            'break_kind' => $entry->break_kind,
            'break_due_minutes' => $entry->break_due_minutes,
            'started_at' => $entry->started_at->toIso8601String(),
        ];
    }

    private function taskPayload(?Task $task): ?array
    {
        return $task ? ['id' => $task->id, 'title' => $task->title] : null;
    }
}
