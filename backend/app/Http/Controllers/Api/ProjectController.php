<?php

namespace App\Http\Controllers\Api;

use App\Models\Client;
use App\Models\Project;
use App\Support\SingleClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class ProjectController extends ApiController
{
    public function index(Request $request): JsonResponse
    {
        $this->permission($request, 'projects.view');
        $query = $this->archived(Project::with(['client', 'status', 'manager'])->withCount(['tasks', 'tasks as done_count' => fn ($q) => $q->whereHas('status', fn ($s) => $s->where('key_name', 'complete'))]), $request);
        if (SingleClient::enabled()) {
            $query->where('client_id', SingleClient::id() ?? 0);
        } elseif ($request->filled('client_id')) {
            $query->where('client_id', $request->integer('client_id'));
        }
        if ($search = $request->string('search')->trim()->toString()) {
            $query->where('name', 'like', "%$search%");
        }
        if ($request->filled('status_value_id')) {
            $query->where('status_value_id', $request->integer('status_value_id'));
        }

        $page = $query->orderByDesc('updated_at')->paginate($this->perPage($request));
        $page->getCollection()->transform(fn (Project $project) => $this->present($project));

        return $this->paginated($page);
    }

    public function store(Request $request): JsonResponse
    {
        $this->permission($request, 'projects.create');
        $project = Project::create($this->withForcedClient($this->validated($request)) + ['created_by' => $request->user()->id]);
        $this->audit($request, 'project.create', $project, $project->toArray());

        return $this->data($this->present($project), 201);
    }

    public function show(Request $request, Project $project): JsonResponse
    {
        $this->permission($request, 'projects.view');
        $this->withinClient($project->client_id);

        return $this->data($this->present($project));
    }

    public function update(Request $request, Project $project): JsonResponse
    {
        $this->permission($request, 'projects.edit');
        $this->withinClient($project->client_id);
        $before = $project->getAttributes();
        $project->update($this->withForcedClient($this->validated($request, true)));
        $this->audit($request, 'project.update', $project, ['before' => $before, 'after' => $project->getAttributes()]);

        return $this->data($this->present($project));
    }

    public function archive(Request $request, Project $project): JsonResponse
    {
        $this->permission($request, 'projects.archive');
        $this->withinClient($project->client_id);
        $this->ensureNoActiveTasks($project);
        $project->update(['archived_at' => now()]);
        $this->audit($request, 'project.archive', $project);

        return $this->data($project);
    }

    public function restore(Request $request, int $project): JsonResponse
    {
        $this->permission($request, 'projects.archive');
        $model = Project::findOrFail($project);
        $this->withinClient($model->client_id);
        $clientIsActive = Client::query()
            ->whereKey($model->client_id)
            ->whereNull('archived_at')
            ->exists();
        abort_unless($clientIsActive, 409, 'Restore the parent client before restoring this project.');
        $model->update(['archived_at' => null]);
        $this->audit($request, 'project.restore', $model);

        return $this->data($this->present($model));
    }

    private function present(Project $project): Project
    {
        $project->load(['client', 'status', 'manager'])->loadCount(['tasks', 'tasks as done_count' => fn ($q) => $q->whereHas('status', fn ($s) => $s->where('key_name', 'complete'))]);
        $project->setRelation('client', $this->summaryRelation($this->clientSummary($project->client)));
        $project->setRelation('manager', $this->summaryRelation($this->userSummary($project->manager)));
        $project->setRelation('status_value', $project->status);

        return $project;
    }

    private function validated(Request $request, bool $partial = false): array
    {
        return $request->validate([
            'client_id' => [Rule::excludeIf(SingleClient::enabled()), $partial ? 'sometimes' : 'required', 'integer', Rule::exists('clients', 'id')->whereNull('archived_at')->whereNull('deleted_at')],
            'name' => [$partial ? 'sometimes' : 'required', 'string', 'max:191'], 'description' => ['sometimes', 'nullable', 'string'],
            'status_value_id' => ['sometimes', 'nullable', $this->fieldValueRule('project_status')], 'manager_user_id' => ['sometimes', 'nullable', Rule::exists('users', 'id')->where('status', 'active')->whereNull('archived_at')->whereNull('deleted_at')],
            'start_date' => ['sometimes', 'nullable', 'date'], 'due_date' => ['sometimes', 'nullable', 'date', 'after_or_equal:start_date'],
        ]);
    }

    private function withForcedClient(array $data): array
    {
        if (SingleClient::enabled()) {
            abort_unless(SingleClient::id(), 409, 'Select a client in single-client settings.');
            $data['client_id'] = SingleClient::id();
        }

        return $data;
    }

    private function withinClient(int $id): void
    {
        if (SingleClient::enabled()) {
            abort_unless($id === SingleClient::id(), 404);
        }
    }

    private function ensureNoActiveTasks(Project $project): void
    {
        abort_if($project->tasks()->whereNull('archived_at')->exists(), 409, 'Archive this project tasks first.');
    }
}
