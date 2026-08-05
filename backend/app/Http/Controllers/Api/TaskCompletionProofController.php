<?php

namespace App\Http\Controllers\Api;

use App\Jobs\AuditTaskCompletionProof;
use App\Models\Task;
use App\Models\TaskCompletionProof;
use App\Services\TaskAttachmentStorage;
use App\Support\SingleClient;
use App\Support\TaskMutationGuard;
use App\Support\TaskStatuses;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class TaskCompletionProofController extends ApiController
{
    public function __construct(private readonly TaskAttachmentStorage $storage) {}

    public function index(Request $request, Task $task): JsonResponse
    {
        $this->permission($request, 'tasks.view');
        $this->withinClient($task);

        return $this->data(
            $task->completionProofs()->with(['submitter', 'reviewer'])->latest('id')->get()
                ->map(fn (TaskCompletionProof $proof) => $this->present($proof))
                ->all()
        );
    }

    /**
     * Completing a task means submitting evidence: a written summary plus at
     * least one file. The task parks in Quality Check until the audit lands.
     */
    public function store(Request $request, Task $task): JsonResponse
    {
        $this->permission($request, 'tasks.change_status');
        TaskMutationGuard::enforce($request, $task);
        $this->withinClient($task);
        abort_if(
            $task->completionProofs()->where('status', 'pending')->exists(),
            409,
            'This task already has completion proof waiting on review.',
        );
        abort_if(
            TaskStatuses::is($task->status_value_id, TaskStatuses::COMPLETE),
            409,
            'This task is already complete.',
        );

        $request->validate([
            'summary' => ['required', 'string', 'min:20', 'max:5000'],
            'files' => ['required', 'array', 'min:1', 'max:'.TaskAttachmentStorage::MAX_FILES_PER_REQUEST],
            'files.*' => ['required', 'file', 'max:'.TaskAttachmentStorage::MAX_FILE_KB],
        ], [
            'summary.required' => 'Describe what you completed before submitting proof.',
            'summary.min' => 'Give the reviewer a bit more detail about what you completed.',
            'files.required' => 'Attach at least one file that shows the work is done.',
            'files.*.max' => 'Each file must be '.(int) (TaskAttachmentStorage::MAX_FILE_KB / 1024).' MB or smaller.',
        ]);

        foreach ($request->file('files') as $file) {
            $this->storage->assertStorable($file);
        }

        $proof = DB::transaction(function () use ($request, $task) {
            $proof = $task->completionProofs()->create([
                'submitted_by' => $request->user()->id,
                'summary' => trim($request->string('summary')),
                'status' => 'pending',
                'ai_state' => 'queued',
                'previous_status_value_id' => $task->status_value_id,
            ]);
            $this->storage->store($task, array_values($request->file('files')), $request->user(), $proof->id);
            $reviewStatus = TaskStatuses::id(TaskStatuses::QUALITY_CHECK);
            if ($reviewStatus) {
                $task->update(['status_value_id' => $reviewStatus]);
            }

            return $proof;
        });

        AuditTaskCompletionProof::dispatch($proof->id)->afterCommit();
        $this->audit($request, 'task.completion_proof.submit', $task, ['proof_id' => $proof->id]);

        return $this->data($this->present($proof->fresh()), 201);
    }

    public function approve(Request $request, Task $task, TaskCompletionProof $proof): JsonResponse
    {
        return $this->settle($request, $task, $proof, true);
    }

    public function reject(Request $request, Task $task, TaskCompletionProof $proof): JsonResponse
    {
        return $this->settle($request, $task, $proof, false);
    }

    /** A human decision always wins over the auditor, and unblocks a stuck task. */
    private function settle(Request $request, Task $task, TaskCompletionProof $proof, bool $approved): JsonResponse
    {
        $this->permission($request, 'tasks.review_completion');
        $this->assertNested($task, $proof);
        TaskMutationGuard::enforceOversight($request, $task);
        $this->withinClient($task);
        abort_unless($proof->isPending(), 409, 'This completion proof has already been settled.');

        $data = $request->validate([
            'reason' => [$approved ? 'sometimes' : 'required', 'string', 'max:2000'],
        ], [
            'reason.required' => 'Tell the submitter what is missing before rejecting their proof.',
        ]);

        $proof->update([
            'status' => $approved ? 'approved' : 'rejected',
            'review_mode' => 'human',
            'review_reason' => isset($data['reason']) ? trim($data['reason']) : null,
            'reviewed_by' => $request->user()->id,
            'reviewed_at' => now(),
        ]);
        $statusId = TaskStatuses::id($approved ? TaskStatuses::COMPLETE : TaskStatuses::NEEDS_CORRECTION);
        if ($statusId) {
            $task->update(['status_value_id' => $statusId]);
        }
        $this->audit($request, $approved ? 'task.completion_proof.approve' : 'task.completion_proof.reject', $task, [
            'proof_id' => $proof->id,
        ]);

        return $this->data($this->present($proof->fresh()));
    }

    /**
     * @return array<string, mixed>
     */
    private function present(TaskCompletionProof $proof): array
    {
        $proof->loadMissing(['submitter', 'reviewer']);

        return $proof->toSummary(
            $this->userSummary($proof->submitter),
            $this->userSummary($proof->reviewer),
        );
    }

    private function assertNested(Task $task, TaskCompletionProof $proof): void
    {
        abort_unless((int) $proof->task_id === (int) $task->id, 404);
    }

    private function withinClient(Task $task): void
    {
        if (SingleClient::enabled()) {
            abort_unless((int) $task->project()->value('client_id') === (int) SingleClient::id(), 404);
        }
    }
}
