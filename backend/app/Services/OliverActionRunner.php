<?php

namespace App\Services;

use App\Models\AuditLog;
use App\Models\FieldValue;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use App\Support\TaskMutationGuard;
use App\Support\TaskStatuses;
use Throwable;

/**
 * Executes what Oliver proposed, under the requesting user's own permissions.
 * Oliver never gains access its operator does not already have, and every
 * change is audited as an AI-assisted action.
 */
class OliverActionRunner
{
    public const MAX_ACTIONS_PER_TURN = 8;

    public function __construct(private readonly TaskMutationService $taskMutations) {}

    /**
     * @param  array<int, array<string, mixed>>  $actions
     * @return array<int, array<string, mixed>>
     */
    public function run(array $actions, User $actor): array
    {
        $results = [];
        foreach (array_slice($actions, 0, self::MAX_ACTIONS_PER_TURN) as $action) {
            $type = (string) ($action['type'] ?? '');
            try {
                $results[] = match ($type) {
                    'create_task' => $this->createTask($action, $actor),
                    'update_task' => $this->updateTask($action, $actor),
                    'assign_task' => $this->assignTask($action, $actor),
                    'comment_task' => $this->commentTask($action, $actor),
                    default => $this->refuse($type, 'That action is not supported.'),
                };
            } catch (Throwable $exception) {
                $results[] = $this->refuse($type, $exception->getMessage());
            }
        }

        return $results;
    }

    /** @param array<string, mixed> $action */
    private function createTask(array $action, User $actor): array
    {
        $this->assertCan($actor, 'tasks.create');
        $title = trim((string) ($action['title'] ?? ''));
        abort_if($title === '', 422, 'A task needs a title.');
        $project = Project::query()->whereNull('archived_at')->find($action['project_id'] ?? 0);
        abort_unless($project, 422, 'That project is not available in this workspace.');

        $task = Task::query()->create([
            'project_id' => $project->id,
            'title' => mb_substr($title, 0, 255),
            'description' => $this->text($action['description'] ?? null, 20000),
            'status_value_id' => TaskStatuses::id('pending'),
            'assignee_user_id' => $this->assignee($action, $actor),
            'due_date' => $this->date($action['due_date'] ?? null),
            'estimated_minutes' => $actor->canDo('tasks.estimate') ? $this->minutes($action['estimated_minutes'] ?? null) : null,
            'actual_minutes' => 0,
            'created_by' => $actor->id,
        ]);
        $this->audit($actor, 'task.oliver.create', $task->id, ['title' => $task->title]);

        return ['type' => 'create_task', 'status' => 'done', 'task_id' => $task->id, 'summary' => "Created “{$task->title}”"];
    }

    /** @param array<string, mixed> $action */
    private function updateTask(array $action, User $actor): array
    {
        $task = $this->task($action, $actor);
        $changes = [];
        if (($title = trim((string) ($action['title'] ?? ''))) !== '') {
            $this->assertCan($actor, 'tasks.edit');
            $changes['title'] = mb_substr($title, 0, 255);
        }
        if (($description = $this->text($action['description'] ?? null, 20000)) !== null) {
            $this->assertCan($actor, 'tasks.edit');
            $changes['description'] = $description;
        }
        if (($due = $this->date($action['due_date'] ?? null)) !== null) {
            $this->assertCan($actor, 'tasks.edit');
            $changes['due_date'] = $due;
        }
        if (($minutes = $this->minutes($action['estimated_minutes'] ?? null)) !== null) {
            $this->assertCan($actor, 'tasks.estimate');
            $changes['estimated_minutes'] = $minutes;
        }
        if (($status = trim((string) ($action['status'] ?? ''))) !== '') {
            $this->assertCan($actor, 'tasks.change_status');
            $value = $this->statusValue($status);
            abort_unless($value, 422, 'That status does not exist.');
            // Completion is proof-gated, so it is never reachable from chat.
            abort_if(
                (string) $value->key_name === TaskStatuses::COMPLETE,
                422,
                'Completing a task needs proof, so it has to be done from the task itself.',
            );
            $changes['status_value_id'] = $value->id;
        }
        abort_if($changes === [], 422, 'That change had nothing to apply.');

        $this->taskMutations->updateTask($task, $changes, $actor);
        $this->audit($actor, 'task.oliver.update', $task->id, ['changed' => array_keys($changes)]);

        return ['type' => 'update_task', 'status' => 'done', 'task_id' => $task->id, 'summary' => "Updated “{$task->title}”"];
    }

    /** @param array<string, mixed> $action */
    private function assignTask(array $action, User $actor): array
    {
        $this->assertCan($actor, 'tasks.assign');
        $task = $this->task($action, $actor);
        $assignee = $this->assignee($action, $actor, true);
        $this->taskMutations->updateTask($task, ['assignee_user_id' => $assignee], $actor);
        $this->audit($actor, 'task.oliver.assign', $task->id, ['assignee_user_id' => $assignee]);
        $name = $assignee ? trim((string) User::query()->whereKey($assignee)->value('first_name')) : 'nobody';

        return ['type' => 'assign_task', 'status' => 'done', 'task_id' => $task->id, 'summary' => "Assigned “{$task->title}” to {$name}"];
    }

    /** @param array<string, mixed> $action */
    private function commentTask(array $action, User $actor): array
    {
        $this->assertCan($actor, 'tasks.comment');
        $task = $this->task($action, $actor);
        $body = $this->text($action['body'] ?? null, 100000);
        abort_if($body === null || trim($body) === '', 422, 'A note needs a body.');
        $this->taskMutations->createNote($task, ['body' => trim($body), 'is_message' => false], $actor);
        $this->audit($actor, 'task.oliver.comment', $task->id);

        return ['type' => 'comment_task', 'status' => 'done', 'task_id' => $task->id, 'summary' => "Added a note to “{$task->title}”"];
    }

    /** @param array<string, mixed> $action */
    private function task(array $action, User $actor): Task
    {
        $task = Task::query()->whereNull('archived_at')->find($action['task_id'] ?? 0);
        abort_unless($task, 422, 'That task is not available in this workspace.');
        // Oliver runs under its operator's permissions, so it must not become a
        // way around the assignee-only rule that operator is held to directly.
        TaskMutationGuard::enforceAssignment($actor, $task);

        return $task;
    }

    /** @param array<string, mixed> $action */
    private function assignee(array $action, User $actor, bool $required = false): ?int
    {
        $id = $action['assignee_user_id'] ?? null;
        if ($id === null) {
            abort_if($required, 422, 'That action needs someone to assign the task to.');

            return null;
        }
        $this->assertCan($actor, 'tasks.assign');
        abort_unless(
            User::query()->whereKey($id)->where('status', 'active')->whereNull('archived_at')->exists(),
            422,
            'That person cannot be assigned work.',
        );

        return (int) $id;
    }

    private function statusValue(string $label): ?FieldValue
    {
        return FieldValue::query()
            ->whereHas('field', fn ($query) => $query->where('key_name', 'task_status'))
            ->where(fn ($query) => $query->where('key_name', str_replace(' ', '_', mb_strtolower($label)))->orWhereRaw('LOWER(label) = ?', [mb_strtolower($label)]))
            ->first();
    }

    private function assertCan(User $actor, string $permission): void
    {
        abort_unless($actor->canDo($permission), 403, 'You do not have permission for that change.');
    }

    private function refuse(string $type, string $message): array
    {
        return ['type' => $type ?: 'unknown', 'status' => 'refused', 'summary' => $message];
    }

    private function text(mixed $value, int $limit): ?string
    {
        if ($value === null) {
            return null;
        }

        return mb_substr((string) $value, 0, $limit);
    }

    private function date(mixed $value): ?string
    {
        $value = trim((string) ($value ?? ''));

        return preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) ? $value : null;
    }

    private function minutes(mixed $value): ?int
    {
        return is_numeric($value) ? max(0, min(1000000, (int) $value)) : null;
    }

    private function audit(User $actor, string $action, int $taskId, ?array $changes = null): void
    {
        AuditLog::create([
            'user_id' => $actor->id,
            'action' => $action,
            'entity_type' => 'Task',
            'entity_id' => $taskId,
            'summary' => $action.' by Oliver',
            'changes_json' => $changes,
        ]);
    }
}
