<?php

namespace App\Http\Controllers\Api;

use App\Models\Task;
use App\Models\TaskEstimateRequest;
use App\Models\User;
use App\Services\AiEstimateReviewCoordinator;
use App\Services\TaskEstimateDecisionService;
use App\Services\TaskMessageService;
use App\Support\SingleClient;
use App\Support\TaskMutationGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class TaskEstimateRequestController extends ApiController
{
    public function __construct(
        private readonly TaskMessageService $messages,
        private readonly TaskEstimateDecisionService $decisions,
        private readonly AiEstimateReviewCoordinator $aiReviews,
    ) {}

    public function index(Request $request, Task $task): JsonResponse
    {
        $this->permission($request, 'tasks.view');
        $this->withinClient($task);
        $this->authorizeParticipant($request, $task);
        $requests = $task->estimateRequests()
            ->with(['requester', 'reviewer', 'decider', 'replacement', 'latestAiReviewRun', 'decisions.decider'])
            ->latest()
            ->get()
            ->map(fn (TaskEstimateRequest $estimateRequest) => $this->present($estimateRequest));

        return $this->data($requests);
    }

    public function store(Request $request, Task $task): JsonResponse
    {
        $this->permission($request, 'tasks.request_estimate');
        // Ahead of the guard on purpose: a non-assignee here is an authorization
        // answer (403 with a reason), not the generic "not your task" 409 the
        // guard would otherwise return first.
        abort_unless((int) $task->assignee_user_id === (int) $request->user()->id, 403, 'Only the current task assignee may request more time.');
        TaskMutationGuard::enforce($request, $task);
        $this->withinClient($task);
        $data = $request->validate([
            'additional_minutes' => ['required', 'integer', 'min:1', 'max:1000000'],
            'reason' => ['required', 'string', 'max:10000'],
        ]);
        $reviewer = $this->eligibleManager($task);
        abort_unless($reviewer, 409, 'Assign an active project manager with estimate-review permission before requesting more time.');

        [$estimateRequest, $root, $replacedIds] = DB::transaction(function () use ($request, $task, $data, $reviewer): array {
            $lockedTask = Task::query()->lockForUpdate()->findOrFail($task->id);
            $project = $lockedTask->project()->firstOrFail();
            abort_unless((int) $lockedTask->assignee_user_id === (int) $request->user()->id, 409, 'The task assignee changed. Refresh before requesting more time.');
            $pending = TaskEstimateRequest::query()
                ->where('task_id', $lockedTask->id)
                ->where('status', 'pending')
                ->lockForUpdate()
                ->get();
            $estimateRequest = TaskEstimateRequest::create([
                'task_id' => $lockedTask->id,
                'requested_by' => $request->user()->id,
                'reviewer_user_id' => $reviewer->id,
                'base_estimated_minutes' => (int) ($lockedTask->estimated_minutes ?? 0),
                'requested_additional_minutes' => $data['additional_minutes'],
                'status' => 'pending',
                'request_reason' => trim($data['reason']),
                'review_mode' => $project->ai_estimate_review_enabled ? 'ai' : 'human',
                'ai_state' => $project->ai_estimate_review_enabled ? 'queued' : null,
            ]);
            $pending->each(fn (TaskEstimateRequest $old) => $old->update([
                'status' => 'replaced',
                'replaced_by_id' => $estimateRequest->id,
                'decided_at' => now(),
            ]));
            $root = $this->messages->start($lockedTask, $request->user(), $reviewer->id, trim($data['reason']), $estimateRequest);

            return [$estimateRequest, $root, $pending->pluck('id')->all()];
        });
        if ($estimateRequest->review_mode === 'ai') {
            $this->aiReviews->queue($estimateRequest, $root);
        }
        $this->audit($request, 'task.estimate_request.create', $task, [
            'estimate_request_id' => $estimateRequest->id,
            'additional_minutes' => $estimateRequest->requested_additional_minutes,
            'replaced_request_ids' => $replacedIds,
        ]);

        return $this->data($this->present($estimateRequest->fresh(['requester', 'reviewer'])), 201);
    }

    public function approve(Request $request, Task $task, TaskEstimateRequest $estimateRequest): JsonResponse
    {
        $this->authorizeReviewer($request, $task, $estimateRequest);
        TaskMutationGuard::enforceOversight($request, $task);
        $data = $request->validate([
            'approved_additional_minutes' => ['sometimes', 'integer', 'min:1', 'max:1000000'],
            'reason' => ['required', 'string', 'max:10000'],
        ]);
        $approved = (int) ($data['approved_additional_minutes'] ?? $estimateRequest->requested_additional_minutes);

        $this->decisions->decide(
            $estimateRequest->id,
            'approve',
            $approved,
            trim($data['reason']),
            'human',
            $request->user()->id,
            null,
            false,
            true,
        );
        $this->audit($request, 'task.estimate_request.approve', $task, [
            'estimate_request_id' => $estimateRequest->id,
            'approved_additional_minutes' => $approved,
        ]);

        return $this->data($this->present($estimateRequest->fresh(['requester', 'reviewer', 'decider'])));
    }

    public function reject(Request $request, Task $task, TaskEstimateRequest $estimateRequest): JsonResponse
    {
        $this->authorizeReviewer($request, $task, $estimateRequest);
        TaskMutationGuard::enforceOversight($request, $task);
        $data = $request->validate(['reason' => ['required', 'string', 'max:10000']]);
        $this->decisions->decide(
            $estimateRequest->id,
            'reject',
            null,
            trim($data['reason']),
            'human',
            $request->user()->id,
        );
        $this->audit($request, 'task.estimate_request.reject', $task, ['estimate_request_id' => $estimateRequest->id]);

        return $this->data($this->present($estimateRequest->fresh(['requester', 'reviewer', 'decider'])));
    }

    public function override(Request $request, Task $task, TaskEstimateRequest $estimateRequest): JsonResponse
    {
        $this->authorizeReviewer($request, $task, $estimateRequest);
        TaskMutationGuard::enforceOversight($request, $task);
        $data = $request->validate([
            'action' => ['required', 'in:approve,reject'],
            'approved_additional_minutes' => ['nullable', 'integer', 'min:1', 'max:1000000', 'required_if:action,approve'],
            'reason' => ['required', 'string', 'max:10000'],
        ]);
        $this->decisions->decide(
            $estimateRequest->id,
            $data['action'],
            $data['action'] === 'approve' ? (int) $data['approved_additional_minutes'] : null,
            trim($data['reason']),
            'human_override',
            $request->user()->id,
            null,
            true,
        );
        $this->audit($request, 'task.estimate_request.override', $task, [
            'estimate_request_id' => $estimateRequest->id,
            'action' => $data['action'],
            'approved_additional_minutes' => $data['approved_additional_minutes'] ?? null,
        ]);

        return $this->data($this->present($estimateRequest->fresh([
            'requester', 'reviewer', 'decider', 'latestAiReviewRun', 'decisions.decider',
        ])));
    }

    private function authorizeParticipant(Request $request, Task $task): void
    {
        if ($request->user()->isAdmin() || (int) $task->assignee_user_id === (int) $request->user()->id) {
            return;
        }
        abort_unless(
            (int) $task->project()->value('manager_user_id') === (int) $request->user()->id
                && $request->user()->canDo('tasks.review_estimate_requests'),
            403,
        );
    }

    private function authorizeReviewer(Request $request, Task $task, TaskEstimateRequest $estimateRequest): void
    {
        $this->withinClient($task);
        abort_unless((int) $estimateRequest->task_id === (int) $task->id, 404);
        if ($request->user()->isAdmin()) {
            return;
        }
        $this->permission($request, 'tasks.review_estimate_requests');
        abort_unless((int) $task->project()->value('manager_user_id') === (int) $request->user()->id, 403, 'Only the current project manager may review this request.');
    }

    private function eligibleManager(Task $task): ?User
    {
        $manager = User::query()->with('role.permissions')
            ->whereKey($task->project()->value('manager_user_id'))
            ->where('status', 'active')
            ->whereNull('archived_at')
            ->first();

        return $manager?->canDo('tasks.review_estimate_requests') ? $manager : null;
    }

    private function withinClient(Task $task): void
    {
        if (SingleClient::enabled()) {
            abort_unless((int) $task->project()->value('client_id') === (int) SingleClient::id(), 404);
        }
    }

    private function present(TaskEstimateRequest $estimateRequest): TaskEstimateRequest
    {
        $estimateRequest->loadMissing(['requester', 'reviewer', 'decider', 'latestAiReviewRun', 'decisions.decider']);
        $estimateRequest->setRelation('requester', $this->summaryRelation($this->userSummary($estimateRequest->requester)));
        $estimateRequest->setRelation('reviewer', $this->summaryRelation($this->userSummary($estimateRequest->reviewer)));
        $estimateRequest->setRelation('decider', $this->summaryRelation($this->userSummary($estimateRequest->decider)));
        $estimateRequest->decisions->each(fn ($decision) => $decision->setRelation(
            'decider', $this->summaryRelation($this->userSummary($decision->decider))
        ));
        $estimateRequest->setAttribute('conversation_id', $estimateRequest->messages()
            ->whereColumn('task_notes.id', 'task_notes.conversation_id')
            ->value('task_notes.id'));

        return $estimateRequest;
    }
}
