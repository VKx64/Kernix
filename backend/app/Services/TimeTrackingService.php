<?php

namespace App\Services;

use App\Models\TaskNote;
use App\Models\TimeBreak;
use App\Models\TimeSession;
use App\Models\User;
use App\Support\TimeSessionCleanup;
use Illuminate\Support\Facades\DB;

class TimeTrackingService
{
    public function statusData(User $user): array
    {
        $session = $this->openSession($user);
        $currentBreak = $session?->breaks->firstWhere('end_at', null);
        $todayMinutes = TaskNote::query()
            ->where('time_logged_by', $user->id)
            ->whereDate('created_at', today())
            ->sum('time_minutes');

        return [
            'session' => $session,
            'entry' => $session,
            'current_break' => $currentBreak,
            'state' => ! $session ? 'clocked_out' : ($currentBreak ? 'break' : 'working'),
            'is_clocked_in' => (bool) $session,
            'clocked_in' => (bool) $session,
            'is_on_break' => (bool) $currentBreak,
            'on_break' => (bool) $currentBreak,
            'started_at' => $session?->clock_in_at,
            'today_minutes' => (int) $todayMinutes,
            'can_mutate_tasks' => (bool) $session && ! $currentBreak,
            // Breaks are intentionally non-bypassable so task activity cannot
            // be recorded as work while the user is paused.
            'can_admin_override' => $user->isAdmin() && ! $currentBreak,
        ];
    }

    public function clockIn(User $user, ?string $notes = null): TimeSession
    {
        abort_if($this->openSession($user), 409, 'You are already clocked in.');

        return DB::transaction(function () use ($user, $notes) {
            User::query()->whereKey($user->id)->lockForUpdate()->firstOrFail();
            abort_if(
                TimeSession::query()->where('user_id', $user->id)->whereNull('clock_out_at')->lockForUpdate()->exists(),
                409,
                'You are already clocked in.',
            );

            return TimeSession::create([
                'user_id' => $user->id,
                'clock_in_at' => now(),
                'notes' => $notes,
            ]);
        });
    }

    public function clockOut(User $user): TimeSession
    {
        $session = $this->openSession($user);
        abort_unless($session, 409, 'You are not clocked in.');
        DB::transaction(function () use ($session) {
            $session->breaks()->whereNull('end_at')->update(['end_at' => now(), 'updated_at' => now()]);
            $session->update(['clock_out_at' => now()]);
        });

        return $session->fresh('breaks');
    }

    public function breakStart(User $user): TimeBreak
    {
        $session = $this->openSession($user);
        abort_unless($session, 409, 'Clock in before starting a break.');
        abort_if($session->breaks()->whereNull('end_at')->exists(), 409, 'A break is already active.');

        return $session->breaks()->create(['start_at' => now()]);
    }

    public function breakEnd(User $user): TimeBreak
    {
        $session = $this->openSession($user);
        $break = $session?->breaks()->whereNull('end_at')->latest('start_at')->first();
        abort_unless($break, 409, 'No active break was found.');
        $break->update(['end_at' => now()]);

        return $break->fresh();
    }

    public function openSession(User $user): ?TimeSession
    {
        TimeSessionCleanup::closeStale($user->id);

        return TimeSession::with('breaks')
            ->where('user_id', $user->id)
            ->whereNull('clock_out_at')
            ->latest('clock_in_at')
            ->first();
    }
}
