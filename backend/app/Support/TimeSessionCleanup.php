<?php

namespace App\Support;

use App\Models\TimeSession;
use Illuminate\Support\Facades\DB;

class TimeSessionCleanup
{
    public static function closeStale(?int $userId = null): int
    {
        return DB::transaction(function () use ($userId): int {
            $now = now();
            $query = TimeSession::query()
                ->whereNull('clock_out_at')
                ->where(function ($sessions) use ($now): void {
                    $sessions->where('clock_in_at', '<', $now->copy()->subDay())
                        ->orWhere('clock_in_at', '>', $now->copy()->addMinutes(5));
                });
            if ($userId !== null) {
                $query->where('user_id', $userId);
            }

            $sessions = $query->lockForUpdate()->get();
            foreach ($sessions as $session) {
                $closedAt = $session->clock_in_at->lt($now->copy()->subDay())
                    ? $session->clock_in_at->copy()->addDay()
                    : $session->clock_in_at->copy();
                $session->breaks()->whereNull('end_at')->update([
                    'end_at' => $closedAt,
                    'updated_at' => $now,
                ]);
                $session->update([
                    'clock_out_at' => $closedAt,
                    'notes' => trim(($session->notes ?? '').' [auto-closed: stale session capped at 24 hours]'),
                ]);
            }

            return $sessions->count();
        });
    }
}
