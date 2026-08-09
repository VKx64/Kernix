<?php

namespace App\Http\Controllers\Api;

use App\Models\Client;
use App\Models\Project;
use App\Services\PortfolioStats;
use App\Support\SingleClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ClientController extends ApiController
{
    public function __construct(private readonly PortfolioStats $stats) {}

    public function index(Request $request): JsonResponse
    {
        $this->permission($request, 'clients.view');
        $query = $this->archived(Client::with('status')->withCount(['contacts', 'projects']), $request);
        $query->where('is_default', false);
        if (SingleClient::enabled()) {
            $query->whereKey(SingleClient::id() ?? 0);
        }
        if ($search = $request->string('search')->trim()->toString()) {
            $query->where(fn ($q) => $q->where('name', 'like', "%$search%")->orWhere('email', 'like', "%$search%"));
        }
        if ($request->filled('status_value_id')) {
            $query->where('status_value_id', $request->integer('status_value_id'));
        }

        $page = $query->orderBy('name')->paginate($this->perPage($request));
        $page->getCollection()->transform(fn (Client $client) => $this->present($client));
        if ($request->boolean('stats')) {
            $stats = $this->stats->forClients($page->getCollection());
            foreach ($page->getCollection() as $client) {
                $client->setAttribute('stats', $stats[(int) $client->id] ?? null);
            }
        }

        return $this->paginated($page);
    }

    public function store(Request $request): JsonResponse
    {
        $this->permission($request, 'clients.create');
        $this->ensureMutable();
        $client = Client::create($this->validated($request) + ['created_by' => $request->user()->id]);
        $this->audit($request, 'client.create', $client, $client->toArray());

        return $this->data($this->present($client), 201);
    }

    public function show(Request $request, Client $client): JsonResponse
    {
        $this->permission($request, 'clients.view');
        $this->assertNotDefault($client);
        if (SingleClient::enabled()) {
            abort_unless($client->id === SingleClient::id(), 404);
        }

        $client = $this->present($client);
        if ($request->user()->canDo('contacts.view')) {
            $client->load('contacts');
        }

        // The detail page always carries the delivery picture, one row per live
        // project, so the client page and the project cards read the same.
        $projects = Project::query()
            ->whereNull('archived_at')
            ->where('client_id', $client->id)
            ->orderBy('name')
            ->get();
        $projectStats = $this->stats->forProjects($projects);
        $client->setAttribute('stats', $this->stats->forClients(collect([$client]))[(int) $client->id]);
        $client->setAttribute('projects', $projects->map(fn (Project $project) => [
            'id' => (int) $project->id,
            'name' => $project->name,
            'stats' => $projectStats[(int) $project->id],
        ])->all());
        $client->setAttribute('activity', $this->stats->activity($projects->pluck('id')->map(fn ($id) => (int) $id)->all()));

        return $this->data($client);
    }

    public function update(Request $request, Client $client): JsonResponse
    {
        $this->permission($request, 'clients.edit');
        $this->ensureMutable();
        $this->assertNotDefault($client);
        $before = $client->getAttributes();
        $client->update($this->validated($request, true));
        $this->audit($request, 'client.update', $client, ['before' => $before, 'after' => $client->getAttributes()]);

        return $this->data($this->present($client->fresh()));
    }

    public function archive(Request $request, Client $client): JsonResponse
    {
        $this->permission($request, 'clients.archive');
        $this->ensureMutable();
        $this->assertNotDefault($client);
        $this->ensureNoActiveDependents($client);
        $client->update(['archived_at' => now()]);
        $this->audit($request, 'client.archive', $client);

        return $this->data($client);
    }

    public function restore(Request $request, int $client): JsonResponse
    {
        $this->permission($request, 'clients.archive');
        $this->ensureMutable();
        $model = Client::findOrFail($client);
        $this->assertNotDefault($model);
        $model->update(['archived_at' => null]);
        $this->audit($request, 'client.restore', $model);

        return $this->data($model);
    }

    private function ensureMutable(): void
    {
        abort_if(SingleClient::enabled(), 403, 'Client management is disabled in single-client mode.');
    }

    /** The hidden "General" client is not a client record anyone reaches by id. */
    private function assertNotDefault(Client $client): void
    {
        abort_if($client->is_default, 404);
    }

    private function ensureNoActiveDependents(Client $client): void
    {
        $hasActiveContacts = $client->contacts()->whereNull('archived_at')->exists();
        $hasActiveProjects = $client->projects()->whereNull('archived_at')->exists();
        abort_if($hasActiveContacts || $hasActiveProjects, 409, 'Archive this client contacts and projects first.');
    }

    private function present(Client $client): Client
    {
        // The list query already eager-loads both; reloading them per row would
        // turn a paginated page into an N+1.
        $client->loadMissing('status');
        if (! array_key_exists('contacts_count', $client->getAttributes())) {
            $client->loadCount(['contacts', 'projects']);
        }
        $client->setRelation('status_value', $client->status);

        return $client;
    }

    private function validated(Request $request, bool $partial = false): array
    {
        $sometimes = $partial ? 'sometimes' : 'required';

        return $request->validate([
            'name' => [$sometimes, 'string', 'max:191'], 'website' => ['sometimes', 'nullable', 'url', 'max:500'],
            'email' => ['sometimes', 'nullable', 'email', 'max:191'], 'phone' => ['sometimes', 'nullable', 'string', 'max:64'],
            'address' => ['sometimes', 'nullable', 'string'], 'city' => ['sometimes', 'nullable', 'string', 'max:128'],
            'province' => ['sometimes', 'nullable', 'string', 'max:128'], 'zip_code' => ['sometimes', 'nullable', 'string', 'max:32'],
            'country' => ['sometimes', 'nullable', 'string', 'max:128'], 'timezone' => ['sometimes', 'nullable', 'timezone'],
            'notes' => ['sometimes', 'nullable', 'string'], 'status_value_id' => ['sometimes', 'nullable', $this->fieldValueRule('client_status')],
        ]);
    }
}
