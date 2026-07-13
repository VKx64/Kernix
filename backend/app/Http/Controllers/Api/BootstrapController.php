<?php

namespace App\Http\Controllers\Api;

use App\Models\Client;
use App\Models\Field;
use App\Models\Project;
use App\Models\Role;
use App\Models\SystemSetting;
use App\Models\TimeSession;
use App\Models\User;
use App\Support\SingleClient;
use App\Support\TimeSessionCleanup;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BootstrapController extends ApiController
{
    public function __invoke(Request $request): JsonResponse
    {
        $user = $request->user()->load(['role.permissions', 'department']);
        $permissions = $user->permissions();
        $canAny = fn (array $keys): bool => collect($keys)->contains(
            fn (string $key): bool => $user->canDo($key)
        );
        $canTrackTime = $user->canDo('time.track');
        $canSeeFields = $canAny(['fields.view', 'tasks.view', 'projects.view', 'clients.view', 'users.view']);
        $canSeeCoworkers = $canAny(['users.view', 'tasks.comment', 'tasks.assign', 'messages.view', 'projects.create', 'projects.edit']);
        $canSeeClients = $canAny(['clients.view', 'contacts.view', 'projects.view', 'tasks.view', 'settings.edit']);
        $canSeeProjects = $canAny(['projects.view', 'tasks.view']);
        $canSeeRoles = $canAny(['roles.view', 'users.view', 'users.create', 'users.edit']);
        $settings = SystemSetting::find(1);
        $session = null;
        if ($canTrackTime) {
            TimeSessionCleanup::closeStale($user->id);
            $session = TimeSession::with('breaks')->where('user_id', $user->id)->whereNull('clock_out_at')->latest('clock_in_at')->first();
        }
        $projects = Project::query()
            ->with('client')
            ->whereNull('archived_at')
            ->whereHas('client', fn ($client) => $client->whereNull('archived_at'));
        if (SingleClient::enabled()) {
            $projects->where('client_id', SingleClient::id() ?? 0);
        }
        $clients = Client::query()->whereNull('archived_at');
        if (SingleClient::enabled()) {
            $clients->whereKey(SingleClient::id() ?? 0);
        }
        $roles = Role::query()->select(['id', 'name', 'key_name'])->whereKey($user->role_id);
        if ($canSeeRoles && $user->isAdmin()) {
            $roles = Role::query()->select(['id', 'name', 'key_name']);
        }

        return $this->data([
            'user' => array_merge($user->toArray(), ['permissions' => $permissions, 'is_admin' => $user->isAdmin()]),
            'permissions' => $permissions,
            'can_admin_override' => $user->isAdmin(),
            'fields' => $canSeeFields
                ? Field::with(['values' => fn ($values) => $values->where('status', 'active')])->orderBy('sort_order')->get()
                : [],
            'settings' => [
                'default_timezone' => $settings?->default_timezone,
                'single_client_mode' => (bool) $settings?->single_client_mode,
                'single_client_id' => $settings?->single_client_id,
            ],
            'time' => $canTrackTime ? [
                'session' => $session,
                'current_break' => $session?->breaks->firstWhere('end_at', null),
                'can_mutate_tasks' => (bool) $session,
            ] : null,
            'coworkers' => $canSeeCoworkers
                ? User::query()->where('status', 'active')->whereNull('archived_at')->orderBy('first_name')->get()
                    ->map(fn (User $coworker) => $this->userSummary($coworker))
                : [],
            'clients' => $canSeeClients
                ? $clients->orderBy('name')->get()->map(fn (Client $client) => $this->clientSummary($client))
                : [],
            'projects' => $canSeeProjects
                ? $projects->orderBy('name')->get()->map(fn (Project $project) => $this->projectSummary($project))
                : [],
            'roles' => $roles->orderBy('name')->get(),
        ]);
    }
}
