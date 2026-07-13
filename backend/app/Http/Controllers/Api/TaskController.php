<?php

namespace App\Http\Controllers\Api;

use App\Models\FieldValue;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use App\Services\TaskMutationService;
use App\Support\SingleClient;
use App\Support\TaskMutationGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class TaskController extends ApiController
{
    public function __construct(private readonly TaskMutationService $taskMutations) {}

    public function index(Request $request): JsonResponse
    {
        $this->permission($request, 'tasks.view');
        $query = $this->archived(Task::query()->with([
            'project.client', 'status', 'type', 'urgency', 'assignee',
        ])->withCount([
            'subtasks',
            'subtasks as completed_subtasks_count' => fn ($subtasks) => $subtasks->whereNotNull('completed_at'),
        ]), $request);
        $this->scopeToClient($query);

        if ($search = $request->string('search')->trim()->toString()) {
            $query->where(fn ($q) => $q
                ->where('title', 'like', "%{$search}%")
                ->orWhereHas('project', fn ($project) => $project->where('name', 'like', "%{$search}%")));
        }
        if ($request->boolean('mine')) {
            $query->where('assignee_user_id', $request->user()->id);
        }
        if ($request->boolean('urgent')) {
            $query->whereHas('urgency', fn ($urgency) => $urgency->whereIn('key_name', ['urgent', 'high']));
        }
        foreach (['project_id', 'assignee_user_id', 'status_value_id', 'type_value_id', 'urgency_value_id'] as $filter) {
            if ($request->filled($filter)) {
                $query->where($filter, $request->integer($filter));
            }
        }

        [$sort, $direction] = $this->sort($request->string('sort', 'due_date')->toString());
        if ($sort === 'urgency') {
            $query->orderByRaw('(SELECT sort_order FROM field_values WHERE field_values.id = tasks.urgency_value_id) ASC');
        } else {
            $query->orderBy($sort, $direction);
        }

        $page = $query->orderBy('id')->paginate($this->perPage($request));
        $page->getCollection()->transform(fn (Task $task) => $this->presentListItem($task));

        return $this->paginated($page);
    }

    public function store(Request $request): JsonResponse
    {
        $this->permission($request, 'tasks.create');
        $this->authorizeRequestedFields($request, true);
        TaskMutationGuard::enforce($request);
        $data = $this->validated($request);
        $this->assertProjectVisible((int) $data['project_id']);
        $project = Project::findOrFail($data['project_id']);
        $activeManager = User::query()
            ->whereKey($project->manager_user_id)
            ->where('status', 'active')
            ->whereNull('archived_at')
            ->value('id');
        $data['assignee_user_id'] ??= $activeManager ?: $request->user()->id;
        $data += [
            'status_value_id' => $this->defaultValue('task_status', 'pending'),
            'type_value_id' => $this->defaultValue('task_type', 'task'),
            'urgency_value_id' => $this->defaultValue('task_urgency', 'normal'),
        ];
        $task = DB::transaction(function () use ($request, $data) {
            $task = Task::create($data + ['actual_minutes' => 0, 'created_by' => $request->user()->id]);
            if ($task->assignee_user_id && (int) $task->assignee_user_id !== (int) $request->user()->id) {
                $actor = trim($request->user()->first_name.' '.$request->user()->last_name) ?: $request->user()->username;
                $task->notes()->create([
                    'body' => "{$actor} assigned this task to you.",
                    'assigned_user_id' => $task->assignee_user_id,
                    'created_by' => $request->user()->id,
                    'is_message' => true,
                ]);
            }

            return $task;
        });
        $this->audit($request, 'task.create', $task, $task->toArray());

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
        TaskMutationGuard::enforce($request);
        $this->withinClient($task);
        $data = $this->validated($request, true);
        if (isset($data['project_id'])) {
            $this->assertProjectVisible((int) $data['project_id']);
        }
        $before = $this->taskMutations->updateTask($task, $data, $request->user());
        $this->audit($request, 'task.update', $task, ['before' => $before, 'after' => $task->getAttributes()]);

        return $this->data($this->present($task->fresh(), $request));
    }

    public function archive(Request $request, Task $task): JsonResponse
    {
        $this->permission($request, 'tasks.archive');
        TaskMutationGuard::enforce($request);
        $this->withinClient($task);
        $task->update(['archived_at' => now()]);
        $this->audit($request, 'task.archive', $task);

        return $this->data($this->present($task, $request));
    }

    public function restore(Request $request, int $task): JsonResponse
    {
        $this->permission($request, 'tasks.archive');
        TaskMutationGuard::enforce($request);
        $model = Task::findOrFail($task);
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
            'title' => [$partial ? 'sometimes' : 'required', 'string', 'max:255'],
            'description' => ['sometimes', 'nullable', 'string'],
            'status_value_id' => ['sometimes', 'nullable', $this->fieldValueRule('task_status')],
            'type_value_id' => ['sometimes', 'nullable', $this->fieldValueRule('task_type')],
            'urgency_value_id' => ['sometimes', 'nullable', $this->fieldValueRule('task_urgency')],
            'due_date' => ['sometimes', 'nullable', 'date'],
            'assignee_user_id' => ['sometimes', 'nullable', Rule::exists('users', 'id')->where('status', 'active')->whereNull('archived_at')->whereNull('deleted_at')],
            'estimated_minutes' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:1000000'],
            'actual_minutes' => ['prohibited'],
        ]);
    }

    private function authorizeRequestedFields(Request $request, bool $creating = false): void
    {
        $requested = $request->all();
        $authorized = $creating;

        if (! $creating && $this->containsAny($requested, [
            'project_id', 'title', 'description', 'type_value_id', 'urgency_value_id', 'due_date',
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

    private function assertProjectVisible(int $projectId): void
    {
        $query = Project::query()->whereKey($projectId)->whereNull('archived_at');
        if (SingleClient::enabled()) {
            $query->where('client_id', SingleClient::id() ?? 0);
        }
        abort_unless($query->exists(), 422, 'Select an active project in the configured client.');
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
            'project.client', 'project.status', 'project.manager', 'status', 'type', 'urgency', 'assignee', 'creator',
            'notes' => fn ($query) => $query->with(['author', 'assignedUser', 'attachments'])->latest(),
            'subtasks' => fn ($query) => $query->with(['status', 'assignee'])->orderBy('sort_order')->orderBy('id'),
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
