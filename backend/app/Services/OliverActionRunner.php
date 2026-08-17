<?php

namespace App\Services;

use App\Models\AuditLog;
use App\Models\FieldValue;
use App\Models\OliverAction;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskNote;
use App\Models\User;
use App\Support\CurrentWorkspace;
use App\Support\TaskMutationGuard;
use App\Support\TaskStatuses;
use Throwable;

/**
 * Executes what Oliver proposed, under the requesting user's own permissions.
 * Oliver never gains access its operator does not already have, and every
 * change is audited as an AI-assisted action.
 *
 * Every successful change also leaves an `oliver_actions` row carrying the few
 * fields a reversal needs, because Oliver acts directly and is gated by Undo
 * rather than by an approval queue.
 */
class OliverActionRunner
{
    public const MAX_ACTIONS_PER_TURN = 8;

    /** Undo is a correction to a fresh mistake, not a way to rewrite history. */
    public const UNDO_WINDOW_HOURS = 24;

    private const STALE_MESSAGE = 'That has changed since Oliver touched it, so undoing now would overwrite the newer edit.';

    /** Task columns that must compare as integers, whichever driver read them. */
    private const INTEGER_FIELDS = ['project_id', 'status_value_id', 'assignee_user_id', 'estimated_minutes'];

    public function __construct(private readonly TaskMutationService $taskMutations) {}

    /**
     * What an action would do, said in the same words the runner uses after
     * doing it. Used when autopilot is off: the teammate sees the proposal in
     * the shape the confirmation will take.
     *
     * @param  array<int, array<string, mixed>>  $actions
     * @return array<int, array<string, mixed>>
     */
    public function describe(array $actions): array
    {
        return array_map(function (array $action): array {
            $type = (string) ($action['type'] ?? 'unknown');
            $title = trim((string) ($action['title'] ?? ''));
            $taskId = isset($action['task_id']) ? (int) $action['task_id'] : 0;
            $subject = $title !== '' ? "“{$title}”" : ($taskId ? "task #{$taskId}" : 'a task');

            return [
                'type' => $type,
                'status' => 'proposed',
                'summary' => match ($type) {
                    'create_task' => "Create {$subject}",
                    'update_task' => "Update {$subject}",
                    'assign_task' => "Reassign {$subject}",
                    'comment_task' => "Add a note to {$subject}",
                    default => "Run {$type}",
                },
            ];
        }, array_slice($actions, 0, self::MAX_ACTIONS_PER_TURN));
    }

    /**
     * @param  array<int, array<string, mixed>>  $actions
     * @return array<int, array<string, mixed>>
     */
    public function run(array $actions, User $actor): array
    {
        $results = [];
        // "Create a task and add a note to it" is the most natural thing to ask
        // for, and the model cannot name the new task's id because it does not
        // exist yet when the turn is written. Anything later in the same turn
        // that names no task falls back to the one just created, which is the
        // only thing it could reasonably have meant.
        $justCreated = null;

        foreach (array_slice($actions, 0, self::MAX_ACTIONS_PER_TURN) as $action) {
            $type = (string) ($action['type'] ?? '');
            if (! isset($action['task_id']) || (int) $action['task_id'] === 0) {
                $action['task_id'] = $justCreated;
            }
            try {
                $result = match ($type) {
                    'create_task' => $this->createTask($action, $actor),
                    'update_task' => $this->updateTask($action, $actor),
                    'assign_task' => $this->assignTask($action, $actor),
                    'comment_task' => $this->commentTask($action, $actor),
                    default => $this->refuse($type, 'That action is not supported.'),
                };
                if ($type === 'create_task' && isset($result['task_id'])) {
                    $justCreated = (int) $result['task_id'];
                }
                $results[] = $result;
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

        // Assignment is deliberately left out of the recorded state: Oliver
        // routinely creates a task and hands it over in the same turn, and a
        // reassignment on its own does not mean somebody started the work.
        $summary = "Created “{$task->title}”";
        $record = $this->record($actor, 'create_task', $task->id, null, [
            'title' => $task->title,
            'project_id' => (int) $task->project_id,
            'status_value_id' => (int) $task->status_value_id,
        ], $summary);

        return ['type' => 'create_task', 'status' => 'done', 'task_id' => $task->id, 'action_id' => $record->id, 'summary' => $summary];
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

        $before = $this->snapshot($task, array_keys($changes));
        $this->taskMutations->updateTask($task, $changes, $actor);
        $this->audit($actor, 'task.oliver.update', $task->id, ['changed' => array_keys($changes)]);

        $summary = "Updated “{$task->title}”";
        $record = $this->record($actor, 'update_task', $task->id, $before, $this->snapshot($task, array_keys($changes)), $summary);

        return ['type' => 'update_task', 'status' => 'done', 'task_id' => $task->id, 'action_id' => $record->id, 'summary' => $summary];
    }

    /** @param array<string, mixed> $action */
    private function assignTask(array $action, User $actor): array
    {
        $this->assertCan($actor, 'tasks.assign');
        $task = $this->task($action, $actor);
        $assignee = $this->assignee($action, $actor, true);
        $before = $this->snapshot($task, ['assignee_user_id']);
        $this->taskMutations->updateTask($task, ['assignee_user_id' => $assignee], $actor);
        $this->audit($actor, 'task.oliver.assign', $task->id, ['assignee_user_id' => $assignee]);
        // Full name: two people sharing a first name is ordinary, and "assigned
        // to Rosa" is not something a teammate should have to disambiguate.
        $person = $assignee ? User::query()->whereKey($assignee)->first(['first_name', 'last_name', 'username']) : null;
        $name = $person
            ? (trim($person->first_name.' '.$person->last_name) ?: $person->username)
            : 'nobody';

        $summary = "Assigned “{$task->title}” to {$name}";
        $record = $this->record($actor, 'assign_task', $task->id, $before, ['assignee_user_id' => $assignee], $summary);

        return ['type' => 'assign_task', 'status' => 'done', 'task_id' => $task->id, 'action_id' => $record->id, 'summary' => $summary];
    }

    /** @param array<string, mixed> $action */
    private function commentTask(array $action, User $actor): array
    {
        $this->assertCan($actor, 'tasks.comment');
        $task = $this->task($action, $actor);
        $body = $this->text($action['body'] ?? null, 100000);
        abort_if($body === null || trim($body) === '', 422, 'A note needs a body.');
        $note = $this->taskMutations->createNote($task, ['body' => trim($body), 'is_message' => false], $actor);
        $this->audit($actor, 'task.oliver.comment', $task->id);

        // The entity stays the task so the rail can link somewhere useful; the
        // note is the one thing the reversal needs.
        $summary = "Added a note to “{$task->title}”";
        $record = $this->record($actor, 'comment_task', $task->id, ['note_id' => (int) $note->id], ['body' => $note->body], $summary);

        return ['type' => 'comment_task', 'status' => 'done', 'task_id' => $task->id, 'action_id' => $record->id, 'summary' => $summary];
    }

    /**
     * Puts one recorded action back. Anything that would overwrite work done
     * since is refused rather than forced: an undo that quietly discards a
     * colleague's edit is worse than no undo at all.
     */
    public function undo(OliverAction $action, User $actor): OliverAction
    {
        abort_unless((int) $action->user_id === (int) $actor->id, 403, 'That action belongs to somebody else.');
        abort_if($action->undone_at !== null, 409, 'That action has already been undone.');
        abort_if(
            $action->created_at === null || $action->created_at->lt(now()->subHours(self::UNDO_WINDOW_HOURS)),
            409,
            'That action is more than a day old, so it can no longer be undone.',
        );

        match ($action->type) {
            'create_task' => $this->undoCreateTask($action),
            'update_task', 'assign_task' => $this->undoTaskChange($action, $actor),
            'comment_task' => $this->undoComment($action),
            default => abort(409, 'That action cannot be undone.'),
        };

        $action->forceFill(['undone_at' => now()])->save();

        return $action;
    }

    private function undoCreateTask(OliverAction $action): void
    {
        $task = $this->undoTarget($action);
        // Archived, never deleted: the task may already be referenced elsewhere.
        $task->update(['archived_at' => now()]);
    }

    private function undoTaskChange(OliverAction $action, User $actor): void
    {
        $task = $this->undoTarget($action);
        $before = $action->before ?? [];
        abort_if($before === [], 409, 'That action did not record enough to be undone.');
        $this->taskMutations->updateTask($task, $before, $actor);
    }

    private function undoComment(OliverAction $action): void
    {
        $note = TaskNote::query()->find($action->before['note_id'] ?? 0);
        abort_unless($note && $note->body === ($action->after['body'] ?? null), 409, self::STALE_MESSAGE);
        $note->delete();
    }

    /** The task as it stands now, refused outright if anything Oliver set has moved on. */
    private function undoTarget(OliverAction $action): Task
    {
        $task = Task::query()->whereNull('archived_at')->find($action->entity_id);
        abort_unless($task, 409, self::STALE_MESSAGE);

        $recorded = $action->after ?? [];
        $current = $this->snapshot($task, array_keys($recorded));
        ksort($recorded);
        ksort($current);
        abort_unless($recorded === $current, 409, self::STALE_MESSAGE);

        return $task;
    }

    /**
     * The handful of task fields an action touched, normalized so a value read
     * back out of json compares exactly against the live one.
     *
     * @param  array<int, string>  $keys
     * @return array<string, mixed>
     */
    private function snapshot(Task $task, array $keys): array
    {
        $values = [];
        foreach ($keys as $key) {
            $value = $key === 'due_date' ? $task->due_date?->toDateString() : $task->getAttribute($key);
            $values[$key] = $value !== null && in_array($key, self::INTEGER_FIELDS, true) ? (int) $value : $value;
        }

        return $values;
    }

    /**
     * @param  array<string, mixed>|null  $before
     * @param  array<string, mixed>  $after
     */
    private function record(User $actor, string $type, int $taskId, ?array $before, array $after, string $summary): OliverAction
    {
        return OliverAction::query()->create([
            'user_id' => $actor->id,
            'type' => $type,
            'entity_type' => 'Task',
            'entity_id' => $taskId,
            'before' => $before,
            'after' => $after,
            'summary' => mb_substr($summary, 0, 255),
        ]);
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
        // `assignee_id` is accepted as well: `response_format` is advisory on
        // several providers, so a model that shortens the field name should not
        // cost the teammate their change.
        $id = $action['assignee_user_id'] ?? $action['assignee_id'] ?? null;
        if ($id === null) {
            abort_if($required, 422, 'That action needs someone to assign the task to.');

            return null;
        }
        $this->assertCan($actor, 'tasks.assign');
        // Workspace scope is explicit here for the same reason it is in the
        // prompt: `User` has no workspace column to scope it implicitly, so an
        // id from another tenant would otherwise validate and stick.
        abort_unless(
            User::query()->inWorkspace(CurrentWorkspace::id())
                ->whereKey($id)->where('status', 'active')->whereNull('archived_at')->exists(),
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
