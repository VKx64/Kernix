<?php

namespace App\Http\Controllers\Api;

use App\Models\FormSubmission;
use App\Models\ProjectForm;
use App\Models\Task;
use App\Services\FormSubmissionConverter;
use App\Support\TaskMutationGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class FormSubmissionController extends ApiController
{
    public function __construct(private readonly FormSubmissionConverter $converter) {}

    public function index(Request $request, ProjectForm $projectForm): JsonResponse
    {
        $this->permission($request, 'forms.view');

        $query = $projectForm->submissions()->with('files')->orderByDesc('id');
        if ($status = $request->string('status')->toString()) {
            $query->where('status', $status);
        }

        return $this->paginated($query->paginate($this->perPage($request)));
    }

    public function show(Request $request, FormSubmission $submission): JsonResponse
    {
        $this->permission($request, 'forms.view');
        $submission->load(['files', 'task']);

        return $this->data($submission);
    }

    /**
     * The clock gate is applied here, in the controller, and nowhere inside
     * FormSubmissionConverter: auto-convert runs with no signed-in user and
     * no open clock, and the service must stay reachable from that path.
     */
    public function convert(Request $request, FormSubmission $submission): JsonResponse
    {
        $this->permission($request, 'forms.review');
        TaskMutationGuard::enforce($request);

        $task = DB::transaction(function () use ($request, $submission) {
            $locked = FormSubmission::query()->whereKey($submission->id)->lockForUpdate()->firstOrFail();
            abort_if($locked->status !== 'new', 409, 'This submission was already decided.');

            return $this->converter->convert($locked, $request->user());
        }, attempts: 3);

        $this->audit($request, 'form_submission.convert', $submission, ['task_id' => $task->id]);

        return $this->data($task->fresh(['project', 'subtasks']), 201);
    }

    public function decline(Request $request, FormSubmission $submission): JsonResponse
    {
        $this->permission($request, 'forms.review');
        $data = $request->validate(['decline_reason' => ['sometimes', 'nullable', 'string', 'max:2000']]);

        DB::transaction(function () use ($request, $submission, $data) {
            $locked = FormSubmission::query()->whereKey($submission->id)->lockForUpdate()->firstOrFail();
            abort_if($locked->status !== 'new', 409, 'This submission was already decided.');
            $locked->update([
                'status' => 'declined',
                'decline_reason' => $data['decline_reason'] ?? null,
                'decided_by' => $request->user()->id,
                'decided_at' => now(),
            ]);
        }, attempts: 3);

        $this->audit($request, 'form_submission.decline', $submission);

        return $this->data($submission->fresh());
    }

    /**
     * A distinct action from convert: only reachable once the original task
     * is gone, and it never returns the submission to the queue.
     */
    public function reconvert(Request $request, FormSubmission $submission): JsonResponse
    {
        $this->permission($request, 'forms.review');
        TaskMutationGuard::enforce($request);

        $task = DB::transaction(function () use ($request, $submission) {
            $locked = FormSubmission::query()->whereKey($submission->id)->lockForUpdate()->firstOrFail();
            abort_if($locked->status !== 'converted', 409, 'Only a converted submission can be converted again.');

            $existingTask = $locked->task_id ? Task::withTrashed()->find($locked->task_id) : null;
            abort_if($existingTask && ! $existingTask->trashed(), 409, 'This submission already has an active task.');

            if ($existingTask) {
                // The unique index on tasks.form_submission_id demands the
                // dead task give up the reference before a new one can claim it.
                $existingTask->update(['form_submission_id' => null]);
            }

            return $this->converter->reconvert($locked, $request->user());
        }, attempts: 3);

        $this->audit($request, 'form_submission.reconvert', $submission, ['task_id' => $task->id]);

        return $this->data($task->fresh(['project', 'subtasks']), 201);
    }
}
