<?php

namespace App\Http\Controllers\Api;

use App\Models\TimeEntry;
use App\Services\TimeEntryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class TimerController extends ApiController
{
    public function __construct(private readonly TimeEntryService $timeEntries) {}

    public function status(Request $request): JsonResponse
    {
        $this->permission($request, 'time.track');

        return $this->data($this->timeEntries->statusData($request->user()));
    }

    public function start(Request $request): JsonResponse
    {
        $this->permission($request, 'time.track');
        $data = $request->validate([
            'task_id' => ['sometimes', 'nullable', 'integer', 'exists:tasks,id'],
        ]);
        $entry = $this->timeEntries->start($request->user(), $data['task_id'] ?? null);
        $this->audit($request, 'time.timer_start', $entry, ['task_id' => $entry->task_id]);

        return $this->data($this->timeEntries->statusData($request->user()), 201);
    }

    public function break(Request $request): JsonResponse
    {
        $this->permission($request, 'time.track');
        $data = $request->validate([
            'kind' => ['required', Rule::in(TimeEntryService::BREAK_KINDS)],
            'due_minutes' => ['required', 'integer', 'min:0', 'max:480'],
        ]);
        $entry = $this->timeEntries->breakStart($request->user(), $data['kind'], (int) $data['due_minutes']);
        $this->audit($request, 'time.timer_break', $entry, ['kind' => $entry->break_kind]);

        return $this->data($this->timeEntries->statusData($request->user()), 201);
    }

    public function resume(Request $request): JsonResponse
    {
        $this->permission($request, 'time.track');
        $entry = $this->timeEntries->resume($request->user());
        $this->audit($request, 'time.timer_resume', $entry, ['task_id' => $entry->task_id]);

        return $this->data($this->timeEntries->statusData($request->user()));
    }

    public function stop(Request $request): JsonResponse
    {
        $this->permission($request, 'time.track');
        $entry = $this->timeEntries->stop($request->user());
        $this->audit($request, 'time.timer_stop', $entry, ['task_id' => $entry->task_id]);
        $status = $this->timeEntries->statusData($request->user());
        // The client toasts what the closed entry banked, which the status
        // payload alone no longer says.
        $status['logged'] = [
            'minutes' => $this->timeEntries->loggedMinutes($entry),
            'task' => $this->closedTask($entry),
        ];

        return $this->data($status);
    }

    private function closedTask(TimeEntry $entry): ?array
    {
        $task = $entry->task()->withTrashed()->first();

        return $task ? ['id' => $task->id, 'title' => $task->title] : null;
    }
}
