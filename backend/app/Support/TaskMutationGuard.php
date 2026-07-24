<?php

namespace App\Support;

use App\Models\Task;
use App\Models\TimeSession;
use App\Models\User;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;

class TaskMutationGuard
{
    public static function enforce(Request $request, ?Task $task = null): void
    {
        self::enforceUser($request->user(), $request->boolean('admin_override') && $request->user()->isAdmin(), $task);
    }

    public static function enforceUser(User $user, bool $override = false, ?Task $task = null): void
    {
        if ($task?->archived_at) {
            throw new HttpResponseException(response()->json([
                'message' => 'Archived tasks are read-only. Restore this task before changing it.',
                'code' => 'TASK_ARCHIVED',
            ], 409));
        }

        TimeSessionCleanup::closeStale($user->id);
        $session = TimeSession::with(['breaks' => fn ($breaks) => $breaks->whereNull('end_at')])
            ->where('user_id', $user->id)
            ->whereNull('clock_out_at')
            ->whereBetween('clock_in_at', [now()->subDay(), now()->addMinutes(5)])
            ->latest('clock_in_at')
            ->first();

        if ($session?->breaks->isNotEmpty()) {
            throw new HttpResponseException(response()->json([
                'message' => 'End your break before changing task work.',
                'code' => 'BREAK_ACTIVE',
            ], 409));
        }

        if (! $session && ! $override) {
            throw new HttpResponseException(response()->json([
                'message' => 'Clock in before changing task work.',
                'code' => 'CLOCK_IN_REQUIRED',
            ], 409));
        }
    }
}
