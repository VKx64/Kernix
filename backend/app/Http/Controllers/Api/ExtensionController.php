<?php

namespace App\Http\Controllers\Api;

use App\Models\FieldValue;
use App\Models\Task;
use App\Models\User;
use App\Services\TaskMutationService;
use App\Services\TimeTrackingService;
use App\Support\SingleClient;
use App\Support\TaskMutationGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Sanctum\PersonalAccessToken;

class ExtensionController extends ApiController
{
    private const PERMISSIONS = [
        'time.track',
        'tasks.view',
        'tasks.change_status',
        'tasks.comment',
        'tasks.log_time',
    ];

    public function __construct(
        private readonly TimeTrackingService $timeTracking,
        private readonly TaskMutationService $taskMutations,
    ) {}

    public function bootstrap(Request $request): JsonResponse
    {
        $user = $request->user()->load(['role.permissions']);
        $permissions = array_values(array_intersect($user->permissions(), self::PERMISSIONS));
        $canTrack = in_array('time.track', $permissions, true);
        $canViewTasks = in_array('tasks.view', $permissions, true);

        return $this->data([
            'user' => $this->extensionUser($user),
            'permissions' => $permissions,
            'workspace' => [
                'name' => config('app.name'),
                'origin' => rtrim((string) config('app.frontend_url'), '/'),
            ],
            'time' => $canTrack ? $this->timeTracking->statusData($user) : null,
            'task_statuses' => $canViewTasks ? $this->taskStatuses() : [],
        ]);
    }

    public function tasks(Request $request): JsonResponse
    {
        $this->permission($request, 'tasks.view');
        $data = $request->validate([
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
            'page' => ['sometimes', 'integer', 'min:1'],
        ]);
        $query = Task::query()
            ->with(['project.client', 'status', 'urgency'])
            ->whereNull('archived_at')
            ->where('assignee_user_id', $request->user()->id);
        if (SingleClient::enabled()) {
            $query->whereHas('project', fn ($project) => $project->where('client_id', SingleClient::id() ?? 0));
        }
        if ($search = trim((string) ($data['search'] ?? ''))) {
            $query->where(fn ($task) => $task
                ->where('title', 'like', "%{$search}%")
                ->orWhereHas('project', fn ($project) => $project->where('name', 'like', "%{$search}%")));
        }
        $page = $query
            ->orderByRaw('due_date IS NULL, due_date ASC')
            ->latest('created_at')
            ->paginate(25);
        $page->getCollection()->transform(fn (Task $task) => $this->extensionTask($task));

        return $this->paginated($page);
    }

    public function updateStatus(Request $request, Task $task): JsonResponse
    {
        $this->permission($request, 'tasks.change_status');
        TaskMutationGuard::enforce($request, $task);
        $this->withinClient($task);
        abort_if($task->archived_at, 409, 'Archived tasks are read-only.');
        $data = $request->validate([
            'status_value_id' => ['required', 'integer', $this->fieldValueRule('task_status')],
        ]);
        $before = $this->taskMutations->updateTask($task, $data, $request->user());
        $this->audit($request, 'task.update', $task, [
            'before' => $before,
            'after' => $task->getAttributes(),
            'source' => 'browser_extension',
        ]);

        return $this->data($this->extensionTask($task->fresh(['project.client', 'status', 'urgency'])));
    }

    public function storeNote(Request $request, Task $task): JsonResponse
    {
        $this->permission($request, 'tasks.comment');
        if ($request->integer('time_minutes') > 0) {
            $this->permission($request, 'tasks.log_time');
        }
        TaskMutationGuard::enforce($request, $task);
        $this->withinClient($task);
        abort_if($task->archived_at, 409, 'Archived tasks are read-only.');
        $data = $request->validate([
            'body' => ['required', 'string', 'max:100000'],
            'time_minutes' => ['sometimes', 'integer', 'min:0', 'max:1000000'],
        ]);
        $note = $this->taskMutations->createNote($task, $data, $request->user());
        $this->audit($request, 'task.note.create', $task, [
            'note_id' => $note->id,
            'time_minutes' => $note->time_minutes,
            'source' => 'browser_extension',
        ]);

        return $this->data([
            'id' => $note->id,
            'body' => $note->body,
            'time_minutes' => (int) ($note->time_minutes ?? 0),
            'created_at' => $note->created_at,
        ], 201);
    }

    public function timeAction(Request $request, string $action): JsonResponse
    {
        $this->permission($request, 'time.track');
        [$event, $model] = match ($action) {
            'clock-in' => ['time.clock_in', $this->timeTracking->clockIn($request->user())],
            'clock-out' => ['time.clock_out', $this->timeTracking->clockOut($request->user())],
            'break-start' => ['time.break_start', $this->timeTracking->breakStart($request->user())],
            'break-end' => ['time.break_end', $this->timeTracking->breakEnd($request->user())],
            default => abort(404),
        };
        $this->audit($request, $event, $model, ['source' => 'browser_extension']);

        return $this->data($this->timeTracking->statusData($request->user()));
    }

    public function destroySession(Request $request): JsonResponse
    {
        $token = $request->user()->currentAccessToken();
        abort_unless($token instanceof PersonalAccessToken, 400, 'An extension token is required.');
        $this->audit($request, 'extension.session.revoke', $token, ['name' => $token->name]);
        $token->delete();

        return response()->json(null, 204);
    }

    private function taskStatuses(): array
    {
        return FieldValue::query()
            ->where('status', 'active')
            ->whereHas('field', fn ($field) => $field->where('key_name', 'task_status'))
            ->orderBy('sort_order')
            ->get()
            ->map(fn (FieldValue $status) => [
                'id' => $status->id,
                'label' => $status->label,
                'key' => $status->key_name,
                'color' => $status->color,
            ])
            ->all();
    }

    private function extensionUser(User $user): array
    {
        return [
            'id' => $user->id,
            'username' => $user->username,
            'name' => trim($user->first_name.' '.$user->last_name),
        ];
    }

    private function extensionTask(Task $task): array
    {
        return [
            'id' => $task->id,
            'title' => $task->title,
            'project' => $this->projectSummary($task->project),
            'status' => $this->fieldSummary($task->status),
            'urgency' => $this->fieldSummary($task->urgency),
            'due_date' => $task->due_date?->toDateString(),
            'estimated_minutes' => (int) ($task->estimated_minutes ?? 0),
            'actual_minutes' => (int) ($task->actual_minutes ?? 0),
        ];
    }

    private function fieldSummary(?FieldValue $value): ?array
    {
        return $value ? [
            'id' => $value->id,
            'label' => $value->label,
            'key' => $value->key_name,
            'color' => $value->color,
        ] : null;
    }

    private function withinClient(Task $task): void
    {
        if (SingleClient::enabled()) {
            abort_unless((int) $task->project()->value('client_id') === (int) SingleClient::id(), 404);
        }
    }
}
