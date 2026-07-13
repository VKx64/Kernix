<?php

namespace App\Http\Controllers\Api;

use App\Models\Task;
use App\Models\TaskNote;
use App\Models\TaskSubtask;
use App\Services\TaskMutationService;
use App\Support\SingleClient;
use App\Support\TaskMutationGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class TaskNoteController extends ApiController
{
    public function __construct(private readonly TaskMutationService $taskMutations) {}

    public function store(Request $request, Task $task): JsonResponse
    {
        $this->permission($request, 'tasks.comment');
        if ($request->integer('time_minutes') > 0) {
            $this->permission($request, 'tasks.log_time');
        }
        TaskMutationGuard::enforce($request);
        $this->withinClient($task);
        $data = $this->validated($request);
        $this->validateSubtask($task, $data['subtask_id'] ?? null);
        $note = $this->taskMutations->createNote($task, $data, $request->user());
        $this->audit($request, 'task.note.create', $task, ['note_id' => $note->id, 'time_minutes' => $note->time_minutes]);

        return $this->data($this->present($note), 201);
    }

    public function update(Request $request, Task $task, TaskNote $note): JsonResponse
    {
        $this->permission($request, 'tasks.comment');
        $changesLoggedMinutes = $request->exists('time_minutes')
            && $request->integer('time_minutes') !== (int) $note->time_minutes;
        $movesLoggedMinutes = $request->exists('subtask_id') && (int) $note->time_minutes > 0
            && (int) $request->input('subtask_id') !== (int) $note->subtask_id;
        if ($changesLoggedMinutes || $movesLoggedMinutes) {
            $this->permission($request, 'tasks.log_time');
        }
        $this->assertNested($task, $note);
        $this->assertNoteMutable($request, $note);
        $this->withinClient($task);
        TaskMutationGuard::enforce($request);
        $data = $this->validated($request, true);
        if (array_key_exists('subtask_id', $data)) {
            $this->validateSubtask($task, $data['subtask_id']);
        }
        $effectiveMessage = array_key_exists('is_message', $data) ? $data['is_message'] : $note->is_message;
        $effectiveRecipient = array_key_exists('assigned_user_id', $data) ? $data['assigned_user_id'] : $note->assigned_user_id;
        $this->validateMessage($data + ['is_message' => $effectiveMessage, 'assigned_user_id' => $effectiveRecipient]);

        DB::transaction(function () use ($request, $task, $note, $data) {
            $lockedTask = Task::query()->lockForUpdate()->findOrFail($task->id);
            $lockedNote = TaskNote::query()->lockForUpdate()->findOrFail($note->id);
            $oldMinutes = (int) ($lockedNote->time_minutes ?? 0);
            $newMinutes = array_key_exists('time_minutes', $data) ? (int) $data['time_minutes'] : $oldMinutes;
            $oldSubtask = $lockedNote->subtask_id;
            $newSubtask = array_key_exists('subtask_id', $data) ? $data['subtask_id'] : $oldSubtask;

            $this->setActual($lockedTask, (int) $lockedTask->actual_minutes + $newMinutes - $oldMinutes);
            if ($oldSubtask && (int) $oldSubtask === (int) $newSubtask) {
                $subtask = TaskSubtask::withTrashed()->lockForUpdate()->findOrFail($oldSubtask);
                $this->setActual($subtask, (int) $subtask->actual_minutes + $newMinutes - $oldMinutes);
            } else {
                if ($oldSubtask) {
                    $subtask = TaskSubtask::withTrashed()->lockForUpdate()->findOrFail($oldSubtask);
                    $this->setActual($subtask, (int) $subtask->actual_minutes - $oldMinutes);
                }
                if ($newSubtask) {
                    $subtask = TaskSubtask::query()->lockForUpdate()->findOrFail($newSubtask);
                    $this->setActual($subtask, (int) $subtask->actual_minutes + $newMinutes);
                }
            }
            if (array_key_exists('time_minutes', $data)) {
                $data['time_logged_by'] = $newMinutes > 0 ? ($lockedNote->time_logged_by ?: $request->user()->id) : null;
            }
            $lockedNote->update($data);
        });
        $this->audit($request, 'task.note.update', $task, ['note_id' => $note->id]);

        return $this->data($this->present($note->fresh()));
    }

    public function destroy(Request $request, Task $task, TaskNote $note): JsonResponse
    {
        $this->permission($request, 'tasks.comment');
        if ((int) $note->time_minutes > 0) {
            $this->permission($request, 'tasks.log_time');
        }
        $this->assertNested($task, $note);
        $this->assertNoteMutable($request, $note);
        $this->withinClient($task);
        TaskMutationGuard::enforce($request);
        DB::transaction(function () use ($task, $note) {
            $lockedTask = Task::query()->lockForUpdate()->findOrFail($task->id);
            $lockedNote = TaskNote::query()->lockForUpdate()->findOrFail($note->id);
            $minutes = (int) ($lockedNote->time_minutes ?? 0);
            $this->setActual($lockedTask, (int) $lockedTask->actual_minutes - $minutes);
            if ($lockedNote->subtask_id) {
                $subtask = TaskSubtask::withTrashed()->lockForUpdate()->find($lockedNote->subtask_id);
                if ($subtask) {
                    $this->setActual($subtask, (int) $subtask->actual_minutes - $minutes);
                }
            }
            $lockedNote->delete();
        });
        $this->audit($request, 'task.note.delete', $task, ['note_id' => $note->id]);

        return response()->json(null, 204);
    }

    private function validated(Request $request, bool $partial = false): array
    {
        return $request->validate([
            'body' => [$partial ? 'sometimes' : 'required', 'string', 'max:100000'],
            'subtask_id' => ['sometimes', 'nullable', 'integer', 'exists:task_subtasks,id'],
            'time_minutes' => ['sometimes', 'integer', 'min:0', 'max:1000000'],
            'assigned_user_id' => ['sometimes', 'nullable', Rule::exists('users', 'id')->where('status', 'active')->whereNull('archived_at')->whereNull('deleted_at')],
            'is_message' => ['sometimes', 'boolean'],
            'actual_minutes' => ['prohibited'],
        ]);
    }

    private function validateSubtask(Task $task, mixed $subtaskId): void
    {
        if ($subtaskId) {
            abort_unless($task->subtasks()->whereKey($subtaskId)->exists(), 422, 'The selected subtask does not belong to this task.');
        }
    }

    private function validateMessage(array $data): void
    {
        if (! empty($data['is_message']) && empty($data['assigned_user_id'])) {
            throw ValidationException::withMessages(['assigned_user_id' => ['Choose a recipient for a message.']]);
        }
    }

    private function assertNested(Task $task, TaskNote $note): void
    {
        abort_unless((int) $note->task_id === (int) $task->id, 404);
    }

    private function assertNoteMutable(Request $request, TaskNote $note): void
    {
        if ($request->user()->isAdmin()) {
            return;
        }
        abort_unless(
            (int) $note->created_by === (int) $request->user()->id && $note->created_at?->gte(now()->subDay()),
            403,
            'Only the note author may change a note within 24 hours.',
        );
    }

    private function withinClient(Task $task): void
    {
        if (SingleClient::enabled()) {
            abort_unless((int) $task->project()->value('client_id') === (int) SingleClient::id(), 404);
        }
    }

    private function setActual(Task|TaskSubtask $model, int $minutes): void
    {
        $model->update(['actual_minutes' => max(0, $minutes)]);
    }

    private function present(TaskNote $note): TaskNote
    {
        $note->load(['author', 'assignedUser', 'timeLogger', 'attachments']);
        $note->setRelation('author', $this->summaryRelation($this->userSummary($note->author)));
        $note->setRelation('assignedUser', $this->summaryRelation($this->userSummary($note->assignedUser)));
        $note->setRelation('timeLogger', $this->summaryRelation($this->userSummary($note->timeLogger)));

        return $note;
    }
}
