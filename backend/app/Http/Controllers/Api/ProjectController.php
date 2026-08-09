<?php

namespace App\Http\Controllers\Api;

use App\Models\Client;
use App\Models\Project;
use App\Models\SystemSetting;
use App\Models\User;
use App\Models\Workspace;
use App\Services\PortfolioStats;
use App\Support\CurrentWorkspace;
use App\Support\SingleClient;
use App\Support\WorkspaceFeatures;
use App\Support\WorkspaceProvisioner;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;

class ProjectController extends ApiController
{
    public function __construct(private readonly PortfolioStats $stats) {}

    public function index(Request $request): JsonResponse
    {
        $this->permission($request, 'projects.view');
        $query = $this->archived(Project::with(['client', 'status', 'manager'])->withCount(['tasks', 'tasks as done_count' => fn ($q) => $q->whereHas('status', fn ($s) => $s->where('key_name', 'complete')), 'memoryEntries as pending_memory_count' => fn ($q) => $q->where('status', 'pending')]), $request);
        $query->where('is_default', false);
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
        if ($request->boolean('stats')) {
            $this->attachStats($page->getCollection());
        }

        return $this->paginated($page);
    }

    public function store(Request $request): JsonResponse
    {
        $this->permission($request, 'projects.create');
        $data = $this->withForcedClient($this->validated($request));
        $this->ensureAiReviewReady($data);
        $project = Project::create($data + ['created_by' => $request->user()->id]);
        $this->audit($request, 'project.create', $project, $project->toArray());

        return $this->data($this->present($project), 201);
    }

    public function show(Request $request, Project $project): JsonResponse
    {
        $this->permission($request, 'projects.view');
        $this->assertNotDefault($project);
        $this->withinClient($project->client_id);

        $project = $this->present($project);
        // The detail page always carries its delivery picture; the list only
        // does so on request, so leaner consumers keep their current payload.
        $this->attachStats(collect([$project]));
        $project->setAttribute('team', $this->stats->team($project));
        $project->setAttribute('activity', $this->stats->activity([(int) $project->id]));

        return $this->data($project);
    }

    public function update(Request $request, Project $project): JsonResponse
    {
        $this->permission($request, 'projects.edit');
        $this->assertNotDefault($project);
        $this->withinClient($project->client_id);
        $before = $project->getAttributes();
        $data = $this->withForcedClient($this->validated($request, true));
        if (array_key_exists('ai_memory_enabled', $data)) {
            $this->permission($request, 'projects.manage_ai_memory');
            abort_unless($request->user()->isAdmin() || (int) $project->manager_user_id === (int) $request->user()->id, 403, 'Only this project manager can change AI memory settings.');
        }
        $this->ensureAiReviewReady($data, $project);
        $project->update($data);
        $this->audit($request, 'project.update', $project, ['before' => $before, 'after' => $project->getAttributes()]);

        return $this->data($this->present($project));
    }

    public function archive(Request $request, Project $project): JsonResponse
    {
        $this->permission($request, 'projects.archive');
        $this->assertNotDefault($project);
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
        $this->assertNotDefault($model);
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

    /** @param Collection<int, Project> $projects */
    private function attachStats(Collection $projects): void
    {
        $stats = $this->stats->forProjects($projects);
        $openTasks = $this->stats->openTasks($projects);
        // Cards carry faces, so the list needs the team as much as the detail
        // page does — batched, not one query per card.
        $teams = $this->stats->teams($projects);
        foreach ($projects as $project) {
            $project->setAttribute('stats', $stats[(int) $project->id] ?? null);
            $project->setAttribute('open_tasks', $openTasks[(int) $project->id] ?? []);
            $project->setAttribute('team', $teams[(int) $project->id] ?? []);
        }
    }

    private function present(Project $project): Project
    {
        $project->load(['client', 'status', 'manager'])->loadCount(['tasks', 'tasks as done_count' => fn ($q) => $q->whereHas('status', fn ($s) => $s->where('key_name', 'complete')), 'memoryEntries as pending_memory_count' => fn ($q) => $q->where('status', 'pending')]);
        $project->setRelation('client', $this->summaryRelation($this->clientSummary($project->client)));
        $project->setRelation('manager', $this->summaryRelation($this->userSummary($project->manager)));
        $project->setRelation('status_value', $project->status);

        return $project;
    }

    private function validated(Request $request, bool $partial = false): array
    {
        return $request->validate([
            'client_id' => [Rule::excludeIf(SingleClient::enabled() || $this->clientsDisabled()), $partial ? 'sometimes' : 'required', 'integer', Rule::exists('clients', 'id')->whereNull('archived_at')->whereNull('deleted_at')],
            'name' => [$partial ? 'sometimes' : 'required', 'string', 'max:191'], 'description' => ['sometimes', 'nullable', 'string'],
            'status_value_id' => ['sometimes', 'nullable', $this->fieldValueRule('project_status')], 'manager_user_id' => ['sometimes', 'nullable', Rule::exists('users', 'id')->where('status', 'active')->whereNull('archived_at')->whereNull('deleted_at')],
            'start_date' => ['sometimes', 'nullable', 'date'], 'due_date' => ['sometimes', 'nullable', 'date', 'after_or_equal:start_date'],
            'ai_estimate_review_enabled' => ['sometimes', 'boolean'],
            'ai_estimate_review_rules' => ['sometimes', 'nullable', 'string', 'max:10000'],
            'ai_task_creation_enabled' => ['sometimes', 'boolean'],
            'ai_memory_enabled' => ['sometimes', 'boolean'],
        ]);
    }

    private function ensureAiReviewReady(array $data, ?Project $project = null): void
    {
        $reviewEnabled = array_key_exists('ai_estimate_review_enabled', $data) ? (bool) $data['ai_estimate_review_enabled'] : (bool) $project?->ai_estimate_review_enabled;
        $enabled = $reviewEnabled
            || (bool) ($data['ai_task_creation_enabled'] ?? $project?->ai_task_creation_enabled)
            || (bool) ($data['ai_memory_enabled'] ?? $project?->ai_memory_enabled);
        if (! $enabled) {
            return;
        }
        $settings = SystemSetting::firstOrFail();
        abort_unless(
            filled($settings->openrouter_api_key) && filled($settings->openrouter_model),
            409,
            'Configure the OpenRouter API key and model before enabling project AI features.',
        );
        if (! $reviewEnabled) {
            return;
        }
        $managerId = array_key_exists('manager_user_id', $data) ? $data['manager_user_id'] : $project?->manager_user_id;
        $manager = User::query()->with('role.permissions')->whereKey($managerId)->where('status', 'active')->whereNull('archived_at')->first();
        abort_unless(
            $manager?->canDo('tasks.review_estimate_requests'),
            409,
            'Assign an active project manager with estimate-review permission before enabling AI estimate review.',
        );
    }

    private function withForcedClient(array $data): array
    {
        if (SingleClient::enabled()) {
            abort_unless(SingleClient::id(), 409, 'Select a client in single-client settings.');
            $data['client_id'] = SingleClient::id();

            return $data;
        }
        if (empty($data['client_id']) && $this->clientsDisabled()) {
            $workspace = $this->currentWorkspace();
            if ($workspace) {
                $data['client_id'] = WorkspaceProvisioner::defaultClient($workspace)->id;
            }
        }

        return $data;
    }

    private function currentWorkspace(): ?Workspace
    {
        $id = CurrentWorkspace::id();

        return $id ? Workspace::find($id) : null;
    }

    private function clientsDisabled(): bool
    {
        $workspace = $this->currentWorkspace();

        return $workspace !== null && ! WorkspaceFeatures::enabled($workspace, WorkspaceFeatures::CLIENTS);
    }

    private function withinClient(int $id): void
    {
        if (SingleClient::enabled()) {
            abort_unless($id === SingleClient::id(), 404);
        }
    }

    /** The hidden "General" project is not a project record anyone reaches by id. */
    private function assertNotDefault(Project $project): void
    {
        abort_if($project->is_default, 404);
    }

    private function ensureNoActiveTasks(Project $project): void
    {
        abort_if($project->tasks()->whereNull('archived_at')->exists(), 409, 'Archive this project tasks first.');
    }
}
