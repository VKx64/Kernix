<?php

namespace App\Http\Controllers\Api;

use App\Models\FieldValue;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskAttachment;
use App\Models\TaskCompletionProof;
use App\Models\TaskFolder;
use App\Models\User;
use App\Services\TaskMutationService;
use App\Support\SingleClient;
use App\Support\TaskMutationGuard;
use App\Support\TaskSignals;
use App\Support\TaskStatuses;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class TaskController extends ApiController
{
    public function __construct(private readonly TaskMutationService $taskMutations) {}

    private const VIEWS = ['triage', 'mine', 'all', 'unassigned', 'done'];

    public function index(Request $request): JsonResponse
    {
        $this->permission($request, 'tasks.view');
        $request->validate(['view' => ['sometimes', 'nullable', Rule::in(self::VIEWS)]]);

        $base = $this->archived(Task::query()->with([
            'project.client', 'folder', 'status', 'type', 'urgency', 'assignee',
        ])->withCount([
            'subtasks',
            'subtasks as completed_subtasks_count' => fn ($subtasks) => $subtasks->whereNotNull('completed_at'),
        ]), $request);
        $this->scopeToClient($base);

        if ($search = $request->string('search')->trim()->toString()) {
            $base->where(fn ($q) => $q
                ->where('title', 'like', "%{$search}%")
                ->orWhereHas('project', fn ($project) => $project->where('name', 'like', "%{$search}%")));
        }
        if ($request->boolean('mine')) {
            $base->where('assignee_user_id', $request->user()->id);
        }
        if ($request->boolean('urgent')) {
            $base->whereHas('urgency', fn ($urgency) => $urgency->whereIn('key_name', ['urgent', 'high']));
        }
        foreach (['project_id', 'task_folder_id', 'status_value_id', 'type_value_id', 'urgency_value_id'] as $filter) {
            if ($request->filled($filter)) {
                $base->where($filter, $request->integer($filter));
            }
        }
        if ($request->filled('assignee_user_id')) {
            if (strtolower($request->string('assignee_user_id')->toString()) === 'none') {
                $base->whereNull('assignee_user_id');
            } else {
                $base->where('assignee_user_id', $request->integer('assignee_user_id'));
            }
        }

        $counts = $this->viewCounts($base, $request);

        $query = clone $base;
        $this->applyView($query, $request->string('view')->toString() ?: null, $request);

        [$sort, $direction] = $this->sort($request->string('sort', 'due_date')->toString());
        if ($sort === 'urgency') {
            $query->orderByRaw('(SELECT sort_order FROM field_values WHERE field_values.id = tasks.urgency_value_id) ASC');
        } else {
            $query->orderBy($sort, $direction);
        }

        $page = $query->orderBy('id')->paginate($this->perPage($request));
        $page->getCollection()->transform(fn (Task $task) => $this->presentListItem($task));

        return $this->paginated($page, $counts);
    }

    /** @return array<string, int> */
    private function viewCounts(Builder $base, Request $request): array
    {
        $counts = [];
        foreach (self::VIEWS as $view) {
            $scoped = clone $base;
            $this->applyView($scoped, $view, $request);
            $counts[$view] = $scoped->count();
        }

        return $counts;
    }

    private function applyView(Builder $query, ?string $view, Request $request): void
    {
        $doneIds = TaskSignals::statusValueIdsForRoles(['done']);
        match ($view) {
            'all' => $query->whereNotIn('status_value_id', $doneIds),
            'mine' => $query->whereNotIn('status_value_id', $doneIds)->where('assignee_user_id', $request->user()->id),
            'unassigned' => $query->whereNotIn('status_value_id', $doneIds)->whereNull('assignee_user_id'),
            'done' => $query->whereIn('status_value_id', $doneIds),
            'triage' => $this->applyTriage($query, $doneIds),
            default => null,
        };
    }

    /** @param array<int, int> $doneIds */
    private function applyTriage(Builder $query, array $doneIds): void
    {
        $today = today()->toDateString();
        $blockedIds = TaskSignals::statusValueIdsForRoles(['blocked']);
        $reviewIds = TaskSignals::statusValueIdsForRoles(['review']);
        $urgentSlugs = array_keys(array_filter(TaskSignals::URGENCY_RANKS, fn (int $rank) => $rank <= 1));

        $query->whereNotIn('status_value_id', $doneIds)
            ->where(fn ($q) => $q
                ->where('due_date', '<=', $today)
                ->orWhereIn('status_value_id', $blockedIds)
                ->orWhereIn('status_value_id', $reviewIds)
                ->orWhere(fn ($unassignedUrgent) => $unassignedUrgent
                    ->whereNull('assignee_user_id')
                    ->whereHas('urgency', fn ($urgency) => $urgency->whereIn('key_name', $urgentSlugs))));
    }

    public function store(Request $request): JsonResponse
    {
        $this->permission($request, 'tasks.create');
        $this->authorizeRequestedFields($request, true);
        TaskMutationGuard::enforce($request);
        $data = $this->validated($request);
        $subtaskDrafts = $data['subtasks'] ?? [];
        unset($data['subtasks']);
        $this->assertProjectVisible((int) $data['project_id']);
        $this->assertFolderBelongsToProject($data['task_folder_id'] ?? null, (int) $data['project_id']);
        $project = Project::findOrFail($data['project_id']);
        $activeManager = User::query()
            ->whereKey($project->manager_user_id)
            ->where('status', 'active')
            ->whereNull('archived_at')
            ->value('id');
        $data['assignee_user_id'] ??= $activeManager ?: $request->user()->id;
        $pendingStatusValueId = $this->defaultValue('task_status', 'pending');
        $data += [
            'status_value_id' => $pendingStatusValueId,
            'type_value_id' => $this->defaultValue('task_type', 'task'),
            'urgency_value_id' => $this->defaultValue('task_urgency', 'normal'),
        ];
        $task = DB::transaction(function () use ($request, $data, $subtaskDrafts, $pendingStatusValueId) {
            $task = Task::create($data + ['actual_minutes' => 0, 'created_by' => $request->user()->id]);
            foreach ($subtaskDrafts as $index => $subtaskDraft) {
                $task->subtasks()->create([
                    'title' => $subtaskDraft['title'],
                    'status_value_id' => $pendingStatusValueId,
                    'sort_order' => ($index + 1) * 10,
                    'actual_minutes' => 0,
                    'created_by' => $request->user()->id,
                ]);
            }
            if ($task->assignee_user_id && (int) $task->assignee_user_id !== (int) $request->user()->id) {
                $actor = trim($request->user()->first_name.' '.$request->user()->last_name) ?: $request->user()->username;
                $message = $task->notes()->create([
                    'body' => "{$actor} assigned this task to you.",
                    'assigned_user_id' => $task->assignee_user_id,
                    'created_by' => $request->user()->id,
                    'is_message' => true,
                ]);
                $message->update(['conversation_id' => $message->id]);
            }

            return $task;
        });
        $this->audit($request, 'task.create', $task, $task->toArray());
        if ($subtaskDrafts !== []) {
            foreach ($task->subtasks()->orderBy('sort_order')->orderBy('id')->get() as $subtask) {
                $this->audit($request, 'task.subtask.create', $task, [
                    'subtask_id' => $subtask->id,
                    'title' => $subtask->title,
                ]);
            }
        }

        return $this->data($this->present($task, $request), 201);
    }

    public function show(Request $request, Task $task): JsonResponse
    {
        $this->permission($request, 'tasks.view');
        $this->withinClient($task);

        return $this->data($this->present($task, $request));
    }

    public function update(Request $request, Task $task): JsonResponse
    {
        $this->authorizeRequestedFields($request);
        TaskMutationGuard::enforce($request, $task);
        $this->withinClient($task);
        $data = $this->validated($request, true);
        if (isset($data['project_id'])) {
            $this->assertProjectVisible((int) $data['project_id']);
        }
        $targetProjectId = (int) ($data['project_id'] ?? $task->project_id);
        if (array_key_exists('project_id', $data)
            && $targetProjectId !== (int) $task->project_id
            && ! array_key_exists('task_folder_id', $data)) {
            $data['task_folder_id'] = null;
        }
        $this->assertFolderBelongsToProject(
            array_key_exists('task_folder_id', $data) ? $data['task_folder_id'] : $task->task_folder_id,
            $targetProjectId,
        );
        $this->assertCompletionIsProven($request, $task, $data);
        $before = $this->taskMutations->updateTask($task, $data, $request->user());
        $this->audit($request, 'task.update', $task, ['before' => $before, 'after' => $task->getAttributes()]);

        return $this->data($this->present($task->fresh(), $request));
    }

    public function archive(Request $request, Task $task): JsonResponse
    {
        $this->permission($request, 'tasks.archive');
        TaskMutationGuard::enforce($request, $task);
        $this->withinClient($task);
        $task->update(['archived_at' => now()]);
        $this->audit($request, 'task.archive', $task);

        return $this->data($this->present($task, $request));
    }

    public function restore(Request $request, int $task): JsonResponse
    {
        $this->permission($request, 'tasks.archive');
        // The task is archived by definition here, so the full guard would
        // reject it as read-only. Clock first, then the assignment check once
        // the row is loaded.
        TaskMutationGuard::enforce($request);
        $model = Task::findOrFail($task);
        TaskMutationGuard::enforceAssignment($request->user(), $model);
        $this->withinClient($model);
        $projectIsActive = Project::query()
            ->whereKey($model->project_id)
            ->whereNull('archived_at')
            ->whereHas('client', fn ($client) => $client->whereNull('archived_at'))
            ->exists();
        abort_unless($projectIsActive, 409, 'Restore the parent client and project before restoring this task.');
        $model->update(['archived_at' => null]);
        $this->audit($request, 'task.restore', $model);

        return $this->data($this->present($model, $request));
    }

    public function destroy(Request $request, Task $task): JsonResponse
    {
        // Deletion is intentionally tied to the existing archive privilege:
        // both actions remove work from active queues and remain clock-gated.
        $this->permission($request, 'tasks.archive');
        // An archived task must stay deletable, so the read-only check is
        // skipped here while the assignment check still applies.
        TaskMutationGuard::enforce($request);
        TaskMutationGuard::enforceAssignment($request->user(), $task);
        $this->withinClient($task);
        $task->delete();
        $this->audit($request, 'task.delete', $task);

        return response()->json(null, 204);
    }

    public function activity(Request $request, Task $task): JsonResponse
    {
        $this->permission($request, 'tasks.view');
        $this->withinClient($task);

        return $this->data($task->auditLogs()->with('user:id,first_name,last_name,username')->latest()->limit(100)->get());
    }

    private function validated(Request $request, bool $partial = false): array
    {
        return $request->validate([
            'project_id' => [$partial ? 'sometimes' : 'required', 'integer', Rule::exists('projects', 'id')->whereNull('archived_at')->whereNull('deleted_at')],
            'task_folder_id' => ['sometimes', 'nullable', 'integer', Rule::exists('task_folders', 'id')],
            'title' => [$partial ? 'sometimes' : 'required', 'string', 'max:255'],
            'description' => ['sometimes', 'nullable', 'string'],
            'status_value_id' => ['sometimes', 'nullable', $this->fieldValueRule('task_status')],
            'type_value_id' => ['sometimes', 'nullable', $this->fieldValueRule('task_type')],
            'urgency_value_id' => ['sometimes', 'nullable', $this->fieldValueRule('task_urgency')],
            'due_date' => ['sometimes', 'nullable', 'date'],
            'assignee_user_id' => ['sometimes', 'nullable', Rule::exists('users', 'id')->where('status', 'active')->whereNull('archived_at')->whereNull('deleted_at')],
            'estimated_minutes' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:1000000'],
            'actual_minutes' => ['prohibited'],
            'subtasks' => [$partial ? 'prohibited' : 'sometimes', 'array', 'list', 'max:50'],
            'subtasks.*' => ['required', 'array:title'],
            'subtasks.*.title' => ['required', 'string', 'max:255'],
        ]);
    }

    private function authorizeRequestedFields(Request $request, bool $creating = false): void
    {
        $requested = $request->all();
        $authorized = $creating;

        if (! $creating && $this->containsAny($requested, [
            'project_id', 'task_folder_id', 'title', 'description', 'type_value_id', 'urgency_value_id', 'due_date',
        ])) {
            $this->permission($request, 'tasks.edit');
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
        if (array_key_exists('subtasks', $requested)) {
            $this->permission($request, 'tasks.subtasks');
            $authorized = true;
        }

        // Prevent an empty or unsupported PATCH from creating an audit entry without
        // an actual task-write permission. Validation still handles prohibited fields.
        if (! $authorized) {
            $this->permission($request, 'tasks.edit');
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

    /**
     * Complete is reached by submitting proof, not by picking it from the
     * status list. Reviewers keep a manual path for corrections.
     *
     * @param  array<string, mixed>  $data
     */
    private function assertCompletionIsProven(Request $request, Task $task, array $data): void
    {
        if (! array_key_exists('status_value_id', $data)
            || ! TaskStatuses::is($data['status_value_id'], TaskStatuses::COMPLETE)
            || TaskStatuses::is($task->status_value_id, TaskStatuses::COMPLETE)) {
            return;
        }
        if ($request->user()->canDo('tasks.review_completion')) {
            return;
        }

        abort_unless(
            $task->completionProofs()->where('status', 'approved')->exists(),
            422,
            'Submit proof of completion for this task instead of setting it to Complete directly.',
        );
    }

    private function assertProjectVisible(int $projectId): void
    {
        $query = Project::query()->whereKey($projectId)->whereNull('archived_at');
        if (SingleClient::enabled()) {
            $query->where('client_id', SingleClient::id() ?? 0);
        }
        abort_unless($query->exists(), 422, 'Select an active project in the configured client.');
    }

    private function assertFolderBelongsToProject(?int $taskFolderId, int $projectId): void
    {
        if ($taskFolderId === null) {
            return;
        }

        if (! TaskFolder::query()->whereKey($taskFolderId)->where('project_id', $projectId)->exists()) {
            throw ValidationException::withMessages([
                'task_folder_id' => ['Select a task folder from the task project.'],
            ]);
        }
    }

    private function withinClient(Task $task): void
    {
        if (SingleClient::enabled()) {
            abort_unless((int) $task->project()->value('client_id') === (int) SingleClient::id(), 404);
        }
    }

    private function scopeToClient($query): void
    {
        if (SingleClient::enabled()) {
            $query->whereHas('project', fn ($project) => $project->where('client_id', SingleClient::id() ?? 0));
        }
    }

    private function defaultValue(string $field, string $key): ?int
    {
        return FieldValue::query()->where('key_name', $key)
            ->whereHas('field', fn ($query) => $query->where('key_name', $field))
            ->value('id');
    }

    private function sort(string $requested): array
    {
        $direction = str_starts_with($requested, '-') ? 'desc' : 'asc';
        $column = ltrim($requested, '-');
        if (! in_array($column, ['due_date', 'created_at', 'updated_at', 'title', 'urgency'], true)) {
            $column = 'due_date';
        }

        return [$column, $direction];
    }

    private function present(Task $task, Request $request): Task
    {
        $relations = [
            'project.client', 'project.status', 'project.manager', 'folder', 'status', 'type', 'urgency', 'assignee', 'creator',
            'notes' => fn ($query) => $query->with(['author', 'assignedUser', 'attachments'])->latest(),
            'subtasks' => fn ($query) => $query->with(['status', 'assignee'])->orderBy('sort_order')->orderBy('id'),
            'attachments' => fn ($query) => $query->with('uploader')->orderByDesc('id'),
            'completionProofs' => fn ($query) => $query->with(['submitter', 'reviewer'])->latest('id'),
        ];
        $canViewEmails = $request->user()->canDo('tasks.email');
        if ($canViewEmails) {
            $relations['emails'] = fn ($query) => $query->with(['sender', 'attachments'])->latest();
        }
        $task->load($relations);
        $task->setRelation('status_value', $task->status);
        $task->setRelation('type_value', $task->type);
        $task->setRelation('urgency_value', $task->urgency);
        foreach ($task->subtasks as $subtask) {
            $subtask->setRelation('assignee', $this->summaryRelation($this->userSummary($subtask->assignee)));
            $subtask->setRelation('status_value', $subtask->status);
        }
        foreach ($task->notes as $note) {
            $note->setRelation('author', $this->summaryRelation($this->userSummary($note->author)));
            $note->setRelation('assignedUser', $this->summaryRelation($this->userSummary($note->assignedUser)));
        }
        // Attachments ship as summaries so no storage path ever reaches a client.
        $task->setRelation('attachments', $task->attachments->map(
            fn (TaskAttachment $attachment) => collect($attachment->toSummary($this->userSummary($attachment->uploader)))
        ));
        $task->setRelation('completionProofs', $task->completionProofs->map(
            fn (TaskCompletionProof $proof) => collect($proof->toSummary(
                $this->userSummary($proof->submitter),
                $this->userSummary($proof->reviewer),
            ))
        ));
        if ($canViewEmails) {
            foreach ($task->emails as $email) {
                $sender = $this->summaryRelation($this->userSummary($email->sender));
                $email->setRelation('sender', $sender);
                $email->setRelation('author', $sender);
            }
        } else {
            $task->unsetRelation('emails');
        }
        $task->setRelation('project', $this->summaryRelation($this->projectSummary($task->project)));
        $task->setRelation('assignee', $this->summaryRelation($this->userSummary($task->assignee)));
        $task->setRelation('creator', $this->summaryRelation($this->userSummary($task->creator)));
        $totals = [
            'taskEstimated' => (int) ($task->estimated_minutes ?? 0),
            'taskActual' => (int) ($task->actual_minutes ?? 0),
            'subtaskEstimated' => (int) $task->subtasks->sum('estimated_minutes'),
            'subtaskActual' => (int) $task->subtasks->sum('actual_minutes'),
            'totalEstimated' => (int) ($task->estimated_minutes ?? 0) + (int) $task->subtasks->sum('estimated_minutes'),
            // Task actual is inclusive of time logged against its subtasks.
            'totalActual' => (int) ($task->actual_minutes ?? 0),
        ];
        $task->setAttribute('timeTotals', $totals);
        $task->setAttribute('time_totals', [
            'task_estimated' => $totals['taskEstimated'], 'task_actual' => $totals['taskActual'],
            'subtask_estimated' => $totals['subtaskEstimated'], 'subtask_actual' => $totals['subtaskActual'],
            'total_estimated' => $totals['totalEstimated'], 'total_actual' => $totals['totalActual'],
        ]);

        return $task;
    }

    private function presentListItem(Task $task): Task
    {
        $task->setRelation('project', $this->summaryRelation($this->projectSummary($task->project)));
        $task->setRelation('assignee', $this->summaryRelation($this->userSummary($task->assignee)));

        return $task;
    }
}
