<?php

namespace App\Http\Controllers\Api;

use App\Models\TimeBreak;
use App\Models\TimeSession;
use App\Services\TimeTrackingService;
use App\Support\TimeSessionCleanup;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TimeController extends ApiController
{
    public function __construct(private readonly TimeTrackingService $timeTracking) {}

    public function status(Request $request): JsonResponse
    {
        $this->permission($request, 'time.track');

        return $this->data($this->timeTracking->statusData($request->user()));
    }

    public function clockIn(Request $request): JsonResponse
    {
        $this->permission($request, 'time.track');
        $data = $request->validate(['notes' => ['sometimes', 'nullable', 'string', 'max:5000']]);
        $session = $this->timeTracking->clockIn($request->user(), $data['notes'] ?? null);
        $this->audit($request, 'time.clock_in', $session);

        return $this->data($session->load('breaks'), 201);
    }

    public function clockOut(Request $request): JsonResponse
    {
        $this->permission($request, 'time.track');
        $session = $this->timeTracking->clockOut($request->user());
        $this->audit($request, 'time.clock_out', $session);

        return $this->data($session);
    }

    public function breakStart(Request $request): JsonResponse
    {
        $this->permission($request, 'time.track');
        $break = $this->timeTracking->breakStart($request->user());
        $this->audit($request, 'time.break_start', $break);

        return $this->data($break, 201);
    }

    public function breakEnd(Request $request): JsonResponse
    {
        $this->permission($request, 'time.track');
        $break = $this->timeTracking->breakEnd($request->user());
        $this->audit($request, 'time.break_end', $break);

        return $this->data($break);
    }

    public function clockedUsers(Request $request): JsonResponse
    {
        $this->permission($request, 'time.view_team');
        TimeSessionCleanup::closeStale();
        $sessions = TimeSession::with(['user.role', 'user.department', 'breaks'])
            ->whereNull('clock_out_at')->latest('clock_in_at')->get();

        return $this->data($sessions);
    }

    public function summary(Request $request): JsonResponse
    {
        $canTrack = $request->user()->canDo('time.track');
        $canViewTeam = $request->user()->canDo('time.view_team');
        abort_unless($canTrack || $canViewTeam, 403, 'You do not have permission to perform this action.');
        $data = $request->validate(['from' => ['sometimes', 'date'], 'to' => ['sometimes', 'date', 'after_or_equal:from'], 'user_id' => ['sometimes', 'integer', 'exists:users,id']]);
        abort_if(isset($data['user_id']) && ! $canViewTeam
            && (int) $data['user_id'] !== (int) $request->user()->id, 403, 'Viewing another user\'s time requires time.view_team.');
        TimeSessionCleanup::closeStale();
        $query = TimeSession::with(['user:id,first_name,last_name,username', 'breaks'])
            ->whereBetween('clock_in_at', [$data['from'] ?? now()->startOfMonth(), Carbon::parse($data['to'] ?? now())->endOfDay()]);
        if (! $canViewTeam) {
            $query->where('user_id', $request->user()->id);
        } elseif (isset($data['user_id'])) {
            $query->where('user_id', $data['user_id']);
        }
        $rows = $query->get()->map(function (TimeSession $session) {
            $end = $session->clock_out_at ?? now();
            $breakSeconds = $session->breaks->sum(fn (TimeBreak $break) => $break->start_at->diffInSeconds($break->end_at ?? now()));
            $seconds = max(0, $session->clock_in_at->diffInSeconds($end) - $breakSeconds);

            return array_merge($session->toArray(), ['worked_minutes' => (int) floor($seconds / 60), 'break_minutes' => (int) floor($breakSeconds / 60)]);
        });

        return $this->data(['sessions' => $rows, 'total_minutes' => $rows->sum('worked_minutes')]);
    }
}
