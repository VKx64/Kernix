<?php

namespace App\Http\Controllers\Api;

use App\Models\Task;
use App\Models\TaskWorkRequest;
use App\Support\SingleClient;
use App\Support\TaskMutationGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Work is limited to your own assignments. This is the sanctioned way to pick
 * up something unexpected: ask, and let whoever assigns work decide.
 */
class TaskWorkRequestController extends ApiController
{
    public function index(Request $request, Task $task): JsonResponse
    {
        $this->permission($request, 'tasks.view');
        $this->withinClient($task);

        $query = $task->workRequests()->with(['requester', 'decider'])->latest();
        // Without review rights you only ever see your own asks.
        if (! $request->user()->canDo('tasks.review_work_requests')) {
            $query->where('requester_user_id', $request->user()->id);
        }

        return $this->data($query->get()->map(fn (TaskWorkRequest $item) => $this->present($item)));
    }

    /**
     * Every pending request across the workspace, for whoever decides them.
     */
    public function pending(Request $request): JsonResponse
    {
        $this->permission($request, 'tasks.review_work_requests');

        $requests = TaskWorkRequest::query()
            ->where('status', TaskWorkRequest::PENDING)
            ->whereHas('task', fn ($task) => $task->whereNull('archived_at'))
            ->with(['requester', 'decider', 'task.project'])
            ->latest()
            ->get()
            ->map(fn (TaskWorkRequest $item) => $this->present($item, true));

        return $this->data($requests);
    }

    public function store(Request $request, Task $task): JsonResponse
    {
        $this->permission($request, 'tasks.request_work');
        // Clock and archive rules still apply; the assignment rule is the very
        // thing being appealed, so it is checked separately below.
        TaskMutationGuard::enforce($request);
        $this->withinClient($task);
        abort_if($task->archived_at, 409, 'Archived tasks are read-only.');
        abort_if(
            (int) $task->assignee_user_id === (int) $request->user()->id,
            409,
            'This task is already assigned to you.'
        );

        $data = $request->validate([
            'reason' => ['required', 'string', 'min:10', 'max:2000'],
        ], [
            'reason.required' => 'Explain why you need to work on this task.',
            'reason.min' => 'Give the reviewer enough detail to decide.',
        ]);

        $workRequest = DB::transaction(function () use ($request, $task, $data) {
            $duplicate = TaskWorkRequest::query()
                ->where('task_id', $task->id)
                ->where('requester_user_id', $request->user()->id)
                ->where('status', TaskWorkRequest::PENDING)
                ->lockForUpdate()
                ->exists();
            abort_if($duplicate, 409, 'You already have a pending request for this task.');

            return TaskWorkRequest::create([
                'task_id' => $task->id,
                'requester_user_id' => $request->user()->id,
                'reason' => trim($data['reason']),
                'status' => TaskWorkRequest::PENDING,
            ]);
        });

        $this->audit($request, 'task.work_request.create', $task, ['work_request_id' => $workRequest->id]);

        return $this->data($this->present($workRequest->fresh(['requester', 'decider'])), 201);
    }

    public function approve(Request $request, Task $task, TaskWorkRequest $workRequest): JsonResponse
    {
        return $this->settle($request, $task, $workRequest, true);
    }

    public function decline(Request $request, Task $task, TaskWorkRequest $workRequest): JsonResponse
    {
        return $this->settle($request, $task, $workRequest, false);
    }

    /**
     * The requester changed their mind. Only they may do this, and only while
     * nobody has decided yet.
     */
    public function withdraw(Request $request, Task $task, TaskWorkRequest $workRequest): JsonResponse
    {
        $this->permission($request, 'tasks.request_work');
        $this->withinClient($task);
        abort_unless((int) $workRequest->task_id === (int) $task->id, 404);
        abort_unless((int) $workRequest->requester_user_id === (int) $request->user()->id, 403, 'Only the requester may withdraw this request.');
        abort_unless($workRequest->isPending(), 409, 'This request has already been settled.');

        $workRequest->update(['status' => TaskWorkRequest::WITHDRAWN, 'decided_at' => now()]);
        $this->audit($request, 'task.work_request.withdraw', $task, ['work_request_id' => $workRequest->id]);

        return $this->data($this->present($workRequest->fresh(['requester', 'decider'])));
    }

    private function settle(Request $request, Task $task, TaskWorkRequest $workRequest, bool $approved): JsonResponse
    {
        $this->permission($request, 'tasks.review_work_requests');
        TaskMutationGuard::enforceOversight($request, $task);
        $this->withinClient($task);
        abort_unless((int) $workRequest->task_id === (int) $task->id, 404);
        abort_unless(
            (int) $workRequest->requester_user_id !== (int) $request->user()->id,
            403,
            'You cannot decide your own request to work on a task.'
        );

        $data = $request->validate([
            'reason' => [$approved ? 'sometimes' : 'required', 'string', 'max:2000'],
        ], [
            'reason.required' => 'Tell the requester why you are declining.',
        ]);

        DB::transaction(function () use ($request, $task, $workRequest, $approved, $data) {
            $locked = TaskWorkRequest::query()->lockForUpdate()->findOrFail($workRequest->id);
            abort_unless($locked->isPending(), 409, 'This request has already been settled.');

            $locked->update([
                'status' => $approved ? TaskWorkRequest::APPROVED : TaskWorkRequest::DECLINED,
                'decided_by' => $request->user()->id,
                'decision_reason' => isset($data['reason']) ? trim($data['reason']) : null,
                'decided_at' => now(),
            ]);

            // Approval is the assignment: saying yes without handing the task
            // over would leave the requester exactly as blocked as before.
            if ($approved) {
                Task::query()->whereKey($task->id)->update(['assignee_user_id' => $locked->requester_user_id]);
            }
        });

        $this->audit($request, $approved ? 'task.work_request.approve' : 'task.work_request.decline', $task, [
            'work_request_id' => $workRequest->id,
            'requester_user_id' => $workRequest->requester_user_id,
        ]);

        return $this->data($this->present($workRequest->fresh(['requester', 'decider'])));
    }

    /**
     * @return array<string, mixed>
     */
    private function present(TaskWorkRequest $workRequest, bool $withTask = false): array
    {
        $summary = $workRequest->toSummary(
            $this->userSummary($workRequest->requester),
            $this->userSummary($workRequest->decider),
        );

        if ($withTask && $workRequest->relationLoaded('task')) {
            $summary['task'] = [
                'id' => $workRequest->task?->id,
                'title' => $workRequest->task?->title,
                'project' => $workRequest->task?->project?->name,
            ];
        }

        return $summary;
    }

    /**
     * Single-client mode hides everything outside the configured client. Copied
     * from its four siblings rather than shared — deduplicating it is worth
     * doing, but not inside an authorization change.
     */
    private function withinClient(Task $task): void
    {
        if (SingleClient::enabled()) {
            abort_unless((int) $task->project()->value('client_id') === (int) SingleClient::id(), 404);
        }
    }
}
