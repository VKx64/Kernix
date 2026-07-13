<?php

namespace App\Support;

use App\Models\TimeSession;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;

class TaskMutationGuard
{
    public static function enforce(Request $request): void
    {
        $user = $request->user();
        $override = $request->boolean('admin_override') && $user->isAdmin();
        TimeSessionCleanup::closeStale($user->id);
        $clockedIn = TimeSession::where('user_id', $user->id)
            ->whereNull('clock_out_at')
            ->whereBetween('clock_in_at', [now()->subDay(), now()->addMinutes(5)])
            ->exists();

        if (! $clockedIn && ! $override) {
            throw new HttpResponseException(response()->json([
                'message' => 'Clock in before changing task work.',
                'code' => 'CLOCK_IN_REQUIRED',
            ], 409));
        }
    }
}
