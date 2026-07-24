<?php

namespace App\Http\Controllers\Api;

use App\Models\FieldValue;
use App\Models\Task;
use App\Models\TaskSubtask;
use App\Support\SingleClient;
use App\Support\TaskMutationGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class TaskSubtaskController extends ApiController
{
    public function store(Request $request, Task $task): JsonResponse
    {
        $this->permission($request, 'tasks.subtasks');
        $this->authorizeRequestedFields($request, true);
        TaskMutationGuard::enforce($request, $task);
        $this->withinClient($task);
        $data = $this->validated($request);
        $data['status_value_id'] ??= $this->defaultStatus();
        $data['sort_order'] ??= (int) $task->subtasks()->max('sort_order') + 10;
        $subtask = $task->subtasks()->create($data + ['actual_minutes' => 0, 'created_by' => $request->user()->id]);
        $this->syncCompletion($subtask);
        $this->audit($request, 'task.subtask.create', $task, ['subtask_id' => $subtask->id, 'title' => $subtask->title]);

        return $this->data($this->present($subtask), 201);
    }

    public function update(Request $request, Task $task, TaskSubtask $subtask): JsonResponse
    {
        $this->authorizeRequestedFields($request);
        TaskMutationGuard::enforce($request, $task);
        $this->assertNested($task, $subtask);
        $this->withinClient($task);
        $data = $this->validated($request, true);
        $subtask->update($data);
        $this->syncCompletion($subtask);
        $this->audit($request, 'task.subtask.update', $task, ['subtask_id' => $subtask->id]);

        return $this->data($this->present($subtask->fresh()));
    }

    public function destroy(Request $request, Task $task, TaskSubtask $subtask): JsonResponse
    {
        $this->permission($request, 'tasks.subtasks');
        TaskMutationGuard::enforce($request, $task);
        $this->assertNested($task, $subtask);
        $this->withinClient($task);
        $subtask->delete();
        $this->audit($request, 'task.subtask.delete', $task, ['subtask_id' => $subtask->id]);

        return response()->json(null, 204);
    }

    public function complete(Request $request, Task $task, TaskSubtask $subtask): JsonResponse
    {
        $this->permission($request, 'tasks.change_status');
        TaskMutationGuard::enforce($request, $task);
        $this->assertNested($task, $subtask);
        $this->withinClient($task);
        $complete = $request->boolean('complete', true);
        $key = $complete ? 'complete' : 'pending';
        $status = FieldValue::query()->where('key_name', $key)
            ->whereHas('field', fn ($field) => $field->where('key_name', 'task_status'))->firstOrFail();
        $subtask->update(['status_value_id' => $status->id, 'completed_at' => $complete ? now() : null]);
        $this->audit($request, 'task.subtask.complete', $task, ['subtask_id' => $subtask->id, 'complete' => $complete]);

        return $this->data($this->present($subtask->fresh()));
    }

    private function validated(Request $request, bool $partial = false): array
    {
        return $request->validate([
            'title' => [$partial ? 'sometimes' : 'required', 'string', 'max:255'],
            'status_value_id' => ['sometimes', 'nullable', $this->fieldValueRule('task_status')],
            'assignee_user_id' => ['sometimes', 'nullable', Rule::exists('users', 'id')->where('status', 'active')->whereNull('archived_at')->whereNull('deleted_at')],
            'due_date' => ['sometimes', 'nullable', 'date'],
            'estimated_minutes' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:1000000'],
            'actual_minutes' => ['prohibited'],
            'sort_order' => ['sometimes', 'integer', 'between:-100000,100000'],
        ]);
    }

    private function authorizeRequestedFields(Request $request, bool $creating = false): void
    {
        $requested = $request->all();
        $authorized = $creating;

        if (! $creating && $this->containsAny($requested, ['title', 'due_date', 'sort_order'])) {
            $this->permission($request, 'tasks.subtasks');
            $authorized = true;
        }
        if (array_key_exists('status_value_id', $requested)) {
            $this->permission($request, 'tasks.change_status');
            $authorized = true;
        }
        if (array_key_exists('assignee_user_id', $requested)) {
            $this->permission($request, 'tasks.assign');
            $authorized = true;
        }
        if (array_key_exists('estimated_minutes', $requested)) {
            $this->permission($request, 'tasks.estimate');
            $authorized = true;
        }

        if (! $authorized) {
            $this->permission($request, 'tasks.subtasks');
        }
    }

    private function containsAny(array $input, array $keys): bool
    {
        foreach ($keys as $key) {
            if (array_key_exists($key, $input)) {
                return true;
            }
        }

        return false;
    }

    private function syncCompletion(TaskSubtask $subtask): void
    {
        $complete = $subtask->status()->where('key_name', 'complete')->exists();
        $subtask->update(['completed_at' => $complete ? ($subtask->completed_at ?? now()) : null]);
    }

    private function defaultStatus(): ?int
    {
        return FieldValue::query()->where('key_name', 'pending')
            ->whereHas('field', fn ($query) => $query->where('key_name', 'task_status'))
            ->value('id');
    }

    private function assertNested(Task $task, TaskSubtask $subtask): void
    {
        abort_unless((int) $subtask->task_id === (int) $task->id, 404);
    }

    private function withinClient(Task $task): void
    {
        if (SingleClient::enabled()) {
            abort_unless((int) $task->project()->value('client_id') === (int) SingleClient::id(), 404);
        }
    }

    private function present(TaskSubtask $subtask): TaskSubtask
    {
        $subtask->load(['status', 'assignee']);
        $subtask->setRelation('assignee', $this->summaryRelation($this->userSummary($subtask->assignee)));
        $subtask->setRelation('status_value', $subtask->status);

        return $subtask;
    }
}
