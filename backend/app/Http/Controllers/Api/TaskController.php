<?php

namespace App\Http\Controllers\Api;

use App\Models\FieldValue;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskAttachment;
use App\Models\TaskCompletionProof;
use App\Models\TaskFolder;
use App\Models\TaskWorkRequest;
use App\Models\User;
use App\Models\Workspace;
use App\Services\TaskMutationService;
use App\Services\TimeEntryService;
use App\Support\CurrentWorkspace;
use App\Support\SingleClient;
use App\Support\TaskAssigneeSync;
use App\Support\TaskMutationGuard;
use App\Support\TaskSignals;
use App\Support\TaskStatuses;
use App\Support\WorkspaceFeatures;
use App\Support\WorkspaceProvisioner;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class TaskController extends ApiController
{
    public function __construct(
        private readonly TaskMutationService $taskMutations,
        private readonly TimeEntryService $timeEntries,
    ) {}

    private const VIEWS = ['triage', 'mine', 'all', 'unassigned', 'done'];

    public function index(Request $request): JsonResponse
    {
        $this->permission($request, 'tasks.view');
        $request->validate(['view' => ['sometimes', 'nullable', Rule::in(self::VIEWS)]]);

        $base = $this->archived(Task::query()->with([
            'project.client', 'folder', 'status', 'type', 'urgency', 'assignee', 'assignees',
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
            $this->whereAssignedTo($base, $request->user()->id);
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
                $this->whereUnassigned($base);
            } else {
                $this->whereAssignedTo($base, $request->integer('assignee_user_id'));
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
            'mine' => $this->whereAssignedTo($query->whereNotIn('status_value_id', $doneIds), $request->user()->id),
            'unassigned' => $this->whereUnassigned($query->whereNotIn('status_value_id', $doneIds)),
            'done' => $query->whereIn('status_value_id', $doneIds),
            'triage' => $this->applyTriage($query, $doneIds),
            default => null,
        };
    }

    /**
     * "Assigned to X" is pivot membership OR a matching `assignee_user_id` —
     * the same union `Task::hasAssignee()` uses, and for the same reason: a
     * bulk `Builder::update()` at an out-of-scope call site can set the
     * column without ever touching the pivot, so the pivot alone cannot be
     * trusted as complete. Expressed via `whereHas`/`whereDoesntHave` rather
     * than a join: `viewCounts()` clones this query and calls `count()` per
     * view, and `index()` paginates it — a join would inflate both for a
     * task with more than one assignee. Soft-deleted users are excluded from
     * the pivot side for free by `User`'s own global scope.
     */
    private function whereAssignedTo(Builder $query, int $userId): Builder
    {
        return $query->where(fn ($q) => $q
            ->where('assignee_user_id', $userId)
            ->orWhereHas('assignees', fn ($assignees) => $assignees->whereKey($userId)));
    }

    /** Unassigned means neither side of the union above resolves to anyone. */
    private function whereUnassigned(Builder $query): Builder
    {
        return $query->whereNull('assignee_user_id')->whereDoesntHave('assignees');
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
                ->orWhere(fn ($unassignedUrgent) => $this->whereUnassigned($unassignedUrgent)
                    ->whereHas('urgency', fn ($urgency) => $urgency->whereIn('key_name', $urgentSlugs))));
    }

    public function store(Request $request): JsonResponse
    {
        $this->permission($request, 'tasks.create');
        $this->authorizeRequestedFields($request, true);
        TaskMutationGuard::enforce($request);
        $data = $this->withDefaultProject($this->validated($request));
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
        $assigneeIds = $this->resolveAssigneeIds($data);
        if ($assigneeIds === null || $assigneeIds === []) {
            // No explicit assignees supplied (including an explicit null
            // scalar) — default to the project manager, or the actor.
            $assigneeIds = [$activeManager ?: $request->user()->id];
        }
        $pendingStatusValueId = $this->defaultValue('task_status', 'pending');
        $data += [
            'status_value_id' => $pendingStatusValueId,
            'type_value_id' => $this->defaultValue('task_type', 'task'),
            'urgency_value_id' => $this->defaultValue('task_urgency', 'normal'),
        ];
        $task = DB::transaction(function () use ($request, $data, $subtaskDrafts, $pendingStatusValueId, $assigneeIds) {
            $task = Task::create($data + ['actual_minutes' => 0, 'created_by' => $request->user()->id]);
            TaskAssigneeSync::apply($task, $assigneeIds);
            foreach ($subtaskDrafts as $index => $subtaskDraft) {
                $task->subtasks()->create([
                    'title' => $subtaskDraft['title'],
                    'status_value_id' => $pendingStatusValueId,
                    'sort_order' => ($index + 1) * 10,
                    'actual_minutes' => 0,
                    'created_by' => $request->user()->id,
                ]);
            }

            // Being given a task is not a conversation. It shows in the
            // assignee's own list and in the task's activity; opening a thread
            // for it buried the messages that are actually somebody talking —
            // asking for more time, flagging that the job is bigger than it
            // looked. Messages is for those.
            return $task;
        });
        $this->audit($request, 'task.create', $task, $task->toArray() + ['assignee_user_ids' => $assigneeIds]);
        $workRequest = $this->askToWorkOnOwnTask($request, $task, $assigneeIds);
        if ($subtaskDrafts !== []) {
            foreach ($task->subtasks()->orderBy('sort_order')->orderBy('id')->get() as $subtask) {
                $this->audit($request, 'task.subtask.create', $task, [
                    'subtask_id' => $subtask->id,
                    'title' => $subtask->title,
                ]);
            }
        }

        // Told plainly rather than left for the client to infer: whoever just
        // filled in the form needs to know the task is waiting on somebody
        // else before they go looking for it in their own list.
        $presented = $this->present($task, $request);
        $presented->setAttribute('work_request_raised', $workRequest !== null);

        return $this->data($presented, 201);
    }

    /**
     * Somebody who cannot assign work has just written down a job for
     * themselves. The task lands on the project manager either way — that is
     * the rule above, not a new one — so this turns "I made a task" into the
     * ask it plainly is, using the same review queue as any other request to
     * pick up work that is not yours.
     *
     * Nothing here grants anything. Until a reviewer approves, the creator is
     * exactly as unassigned as they were a moment before, which is the point:
     * a person cannot route work to themselves by writing it down.
     *
     * Silent for anyone who can assign — a manager creating a task for a
     * colleague is not asking permission — and for a task that did land on the
     * creator, where there is nothing to approve.
     */
    private function askToWorkOnOwnTask(Request $request, Task $task, array $assigneeIds): ?TaskWorkRequest
    {
        $user = $request->user();

        if ($user->canDo('tasks.assign') || ! $user->canDo('tasks.request_work')) {
            return null;
        }
        if (in_array((int) $user->id, array_map('intval', $assigneeIds), true)) {
            return null;
        }

        return TaskWorkRequest::create([
            'task_id' => $task->id,
            'requester_user_id' => $user->id,
            'reason' => 'Raised this task and asked to work on it.',
            'status' => TaskWorkRequest::PENDING,
        ]);
    }

    /**
     * Correct what a task actually cost.
     *
     * Logged time is recomputed from the timer entries and the minutes on the
     * task's notes, so it could only ever go up: a timer left running through
     * lunch, or a mistyped 300, stayed on the record. This writes the
     * difference as a note of its own, which means the correction survives the
     * next recompute, shows in the task's own history, and says who made it.
     *
     * The minutes land on whoever was doing the work rather than whoever fixed
     * the number, because the figure being corrected is theirs — it is their
     * timesheet that was wrong.
     */
    public function adjustTime(Request $request, Task $task): JsonResponse
    {
        $this->permission($request, 'tasks.adjust_time');
        TaskMutationGuard::enforceOversight($request, $task);
        $this->withinClient($task);
        abort_if($task->archived_at, 409, 'Archived tasks are read-only.');

        $data = $request->validate([
            // A task that took more than a fortnight of solid hours is a typo,
            // not a correction.
            'minutes' => ['required', 'integer', 'min:0', 'max:100000'],
            'reason' => ['sometimes', 'nullable', 'string', 'max:500'],
        ]);

        $target = (int) $data['minutes'];
        $before = (int) $task->actual_minutes;
        $difference = $target - $before;

        if ($difference !== 0) {
            $reason = trim((string) ($data['reason'] ?? ''));
            $task->notes()->create([
                'body' => $reason !== '' ? $reason : $this->correctionLine($before, $target),
                'time_minutes' => $difference,
                // Whose time this is, not who typed it. Falls back to the
                // person making the correction when nobody is assigned.
                'time_logged_by' => $task->assignee_user_id ?? $request->user()->id,
                'created_by' => $request->user()->id,
                'is_message' => false,
            ]);
            $this->timeEntries->reconcile($task->id);
        }

        $this->audit($request, 'task.time.adjust', $task, [
            'before_minutes' => $before,
            'after_minutes' => $target,
        ]);

        return $this->data($this->present($task->fresh(), $request));
    }

    private function correctionLine(int $before, int $after): string
    {
        $spoken = fn (int $minutes) => $minutes >= 60
            ? rtrim(rtrim(number_format($minutes / 60, 2, '.', ''), '0'), '.').'h'
            : $minutes.'m';

        return "Corrected the logged time from {$spoken($before)} to {$spoken($after)}.";
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
        $assigneeIds = $this->resolveAssigneeIds($data);
        if ($assigneeIds !== null) {
            $data['assignee_user_ids'] = $assigneeIds;
        }
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
        $this->audit($request, 'task.update', $task, [
            'before' => $before,
            'after' => $task->getAttributes() + ['assignee_user_ids' => $task->assignees()->pluck('users.id')->all()],
        ]);

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
            'project_id' => [Rule::excludeIf($this->projectsDisabled()), $partial ? 'sometimes' : 'required', 'integer', Rule::exists('projects', 'id')->whereNull('archived_at')->whereNull('deleted_at')],
            'task_folder_id' => ['sometimes', 'nullable', 'integer', Rule::exists('task_folders', 'id')],
            'title' => [$partial ? 'sometimes' : 'required', 'string', 'max:255'],
            'description' => ['sometimes', 'nullable', 'string'],
            'status_value_id' => ['sometimes', 'nullable', $this->fieldValueRule('task_status')],
            'type_value_id' => ['sometimes', 'nullable', $this->fieldValueRule('task_type')],
            'urgency_value_id' => ['sometimes', 'nullable', $this->fieldValueRule('task_urgency')],
            'due_date' => ['sometimes', 'nullable', 'date'],
            // Membership + active/non-archived/workspace-scoping are checked
            // explicitly in assertAssigneesValid(), which can express the
            // workspace scope; Rule::exists cannot join workspace_user.
            'assignee_user_id' => ['sometimes', 'nullable', 'integer'],
            'assignee_user_ids' => ['sometimes', 'array'],
            'assignee_user_ids.*' => ['integer'],
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
        if (array_key_exists('assignee_user_id', $requested) || array_key_exists('assignee_user_ids', $requested)) {
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
     * Accepts either the legacy scalar `assignee_user_id` or the array
     * `assignee_user_ids` and coerces both into the array shape everything
     * downstream expects. Both keys are removed from $data — neither is a
     * real column write; `assignee_user_id` is a derived mirror maintained
     * by `TaskAssigneeSync`, and `assignee_user_ids` isn't a column at all.
     *
     * Returns null when the caller touched neither key at all (a partial
     * update that leaves assignment untouched). An explicit null scalar, or
     * an explicit empty array, means "detach everyone" and returns [].
     *
     * @param  array<string, mixed>  $data
     * @return array<int, int>|null
     */
    private function resolveAssigneeIds(array &$data): ?array
    {
        $hasArray = array_key_exists('assignee_user_ids', $data);
        $hasScalar = array_key_exists('assignee_user_id', $data);
        if (! $hasArray && ! $hasScalar) {
            return null;
        }

        $ids = $hasArray
            ? array_values(array_unique(array_map('intval', $data['assignee_user_ids'])))
            : ($data['assignee_user_id'] === null ? [] : [(int) $data['assignee_user_id']]);

        unset($data['assignee_user_ids'], $data['assignee_user_id']);

        if ($ids !== []) {
            $this->assertAssigneesValid($ids);
        }

        return $ids;
    }

    /**
     * Active, non-archived, and — this is the security fix from the plan
     * review — a member of the workspace the task itself is scoped to.
     * Without this, attaching a foreign-workspace user as an assignee would
     * grant them mutation rights through TaskMutationGuard::enforceAssignment.
     *
     * @param  array<int, int>  $userIds
     */
    private function assertAssigneesValid(array $userIds): void
    {
        $workspaceId = CurrentWorkspace::id();
        $valid = User::query()
            ->whereIn('id', $userIds)
            ->where('status', 'active')
            ->whereNull('archived_at')
            ->when($workspaceId, fn ($query) => $query->inWorkspace($workspaceId))
            ->count();

        if ($valid !== count($userIds)) {
            throw ValidationException::withMessages([
                'assignee_user_ids' => ['Select an active user from this workspace.'],
            ]);
        }
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

    /** @param array<string, mixed> $data */
    private function withDefaultProject(array $data): array
    {
        if (empty($data['project_id']) && $this->projectsDisabled()) {
            $workspace = $this->currentWorkspace();
            if ($workspace) {
                $data['project_id'] = WorkspaceProvisioner::defaultProject($workspace)->id;
            }
        }

        return $data;
    }

    private function currentWorkspace(): ?Workspace
    {
        $id = CurrentWorkspace::id();

        return $id ? Workspace::find($id) : null;
    }

    private function projectsDisabled(): bool
    {
        $workspace = $this->currentWorkspace();

        return $workspace !== null && ! WorkspaceFeatures::enabled($workspace, WorkspaceFeatures::PROJECTS);
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
            'project.client', 'project.status', 'project.manager', 'folder', 'status', 'type', 'urgency', 'assignee', 'assignees', 'creator',
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
        // `task_assignees`, not `assignees`: BootstrapController already emits
        // an unrelated `assignees` field (the selectable-user lookup list),
        // and reusing the name on a per-task payload would be confusing for
        // any consumer reading both shapes side by side. The `assignees`
        // relation is unset below so it never leaks into the JSON body under
        // its own name.
        $task->setAttribute('task_assignees', $task->assignees->map(
            fn (User $assignee) => collect($this->userSummary($assignee))
        )->values());
        $task->unsetRelation('assignees');
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
        $task->setAttribute('task_assignees', $task->assignees->map(
            fn (User $assignee) => collect($this->userSummary($assignee))
        )->values());
        $task->unsetRelation('assignees');

        return $task;
    }
}
