<?php

namespace App\Services;

use App\Models\Task;
use App\Models\TaskNote;
use App\Models\TaskSubtask;
use App\Models\User;
use App\Support\TaskAssigneeSync;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class TaskMutationService
{
    public function __construct(private readonly ProjectMemoryService $projectMemory) {}

    /**
     * `assignee_user_ids`, when present, replaces the whole assignee set (the
     * controller has already coerced a legacy scalar `assignee_user_id` into
     * this shape). It never reaches `$task->update()` — the column doesn't
     * exist — it is stripped here and applied through `TaskAssigneeSync`
     * inside the same transaction as the rest of the update.
     *
     * Only *newly added* assignees are notified, one directed note each, so
     * reassigning a task away from someone and back doesn't spam either
     * party and someone already on the task isn't renotified.
     */
    public function updateTask(Task $task, array $data, User $actor): array
    {
        $assigneeIds = null;
        if (array_key_exists('assignee_user_ids', $data)) {
            $assigneeIds = array_values(array_unique(array_map('intval', $data['assignee_user_ids'])));
            unset($data['assignee_user_ids']);
        }

        return DB::transaction(function () use ($task, $data, $actor, $assigneeIds) {
            $beforeAssigneeIds = $task->assignees()->pluck('users.id')->all();
            $before = $task->getAttributes();
            $before['assignee_user_ids'] = $beforeAssigneeIds;

            $task->update($data);

            $assigneeIdsChanged = $assigneeIds !== null && $assigneeIds !== $beforeAssigneeIds;
            $afterAssigneeIds = $assigneeIdsChanged
                ? TaskAssigneeSync::apply($task, $assigneeIds)
                : $beforeAssigneeIds;

            $this->projectMemory->afterTaskUpdate($task, isset($before['status_value_id']) ? (int) $before['status_value_id'] : null);

            $actorName = trim($actor->first_name.' '.$actor->last_name) ?: $actor->username;
            foreach (array_diff($afterAssigneeIds, $beforeAssigneeIds) as $newlyAssignedId) {
                if ((int) $newlyAssignedId === (int) $actor->id) {
                    continue;
                }
                $message = $task->notes()->create([
                    'body' => "{$actorName} assigned this task to you.",
                    'assigned_user_id' => $newlyAssignedId,
                    'created_by' => $actor->id,
                    'is_message' => true,
                ]);
                $message->update(['conversation_id' => $message->id]);
            }

            return $before;
        });
    }

    public function createNote(Task $task, array $data, User $actor): TaskNote
    {
        $data = $this->withNotificationRecipient($actor, $task, $data);
        if (! empty($data['is_message']) && empty($data['assigned_user_id'])) {
            throw ValidationException::withMessages([
                'assigned_user_id' => ['Choose a recipient for a message.'],
            ]);
        }

        return DB::transaction(function () use ($task, $data, $actor) {
            $lockedTask = Task::query()->lockForUpdate()->findOrFail($task->id);
            $minutes = (int) ($data['time_minutes'] ?? 0);
            $note = $lockedTask->notes()->create($data + [
                'created_by' => $actor->id,
                'time_logged_by' => $minutes > 0 ? $actor->id : null,
            ]);
            if ($note->is_message && ! $note->conversation_id) {
                $note->update(['conversation_id' => $note->id]);
            }
            if ($minutes > 0) {
                $lockedTask->increment('actual_minutes', $minutes);
                if ($note->subtask_id) {
                    TaskSubtask::query()->whereKey($note->subtask_id)->lockForUpdate()->firstOrFail()->increment('actual_minutes', $minutes);
                }
            }

            return $note;
        });
    }

    private function withNotificationRecipient(User $actor, Task $task, array $data): array
    {
        if (array_key_exists('is_message', $data) && $data['is_message'] === false && empty($data['assigned_user_id'])) {
            return $data;
        }

        if (! empty($data['assigned_user_id'])) {
            $data['is_message'] = true;

            return $data;
        }

        $recipient = null;
        if ($task->assignee_user_id && (int) $task->assignee_user_id !== (int) $actor->id) {
            $recipient = $task->assignee_user_id;
        } elseif ($task->created_by && (int) $task->created_by !== (int) $actor->id) {
            $recipient = $task->created_by;
        }
        if ($recipient) {
            $data['assigned_user_id'] = $recipient;
            $data['is_message'] = true;
        }

        return $data;
    }
}
