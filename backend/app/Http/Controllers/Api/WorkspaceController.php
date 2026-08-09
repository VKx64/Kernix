<?php

namespace App\Http\Controllers\Api;

use App\Models\User;
use App\Models\Workspace;
use App\Support\CurrentWorkspace;
use App\Support\WorkspaceProvisioner;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class WorkspaceController extends ApiController
{
    /** Every signed-in user sees the workspaces they belong to. */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $activeId = CurrentWorkspace::forUser($user);
        $workspaces = ($user->isAdmin() ? Workspace::query() : $user->workspaces()->getQuery())
            ->withCount('members')
            ->orderBy('workspaces.name')
            ->get();

        return $this->data($workspaces->map(
            fn (Workspace $workspace) => $workspace->toSummary((int) $workspace->id === (int) $activeId, (int) $workspace->members_count)
        )->all());
    }

    /**
     * Two callers reach this: somebody finishing onboarding, who belongs to no
     * workspace yet and needs no permission to make their first one, and an
     * administrator adding another workspace, who does. Either way the new
     * workspace is provisioned with its own roles and the creator is its
     * administrator.
     */
    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        $onboarding = $user->needsWorkspace();
        if (! $onboarding) {
            $this->permission($request, 'workspaces.manage');
        }
        $data = $request->validate([
            'name' => ['required', 'string', 'min:2', 'max:191'],
            'activate' => ['sometimes', 'boolean'],
        ]);
        $activate = $onboarding || ($data['activate'] ?? true);
        $previousWorkspaceId = $user->active_workspace_id;

        $workspace = WorkspaceProvisioner::provision($user, $data['name']);
        if (! $activate) {
            $user->forceFill(['active_workspace_id' => $previousWorkspaceId])->save();
            $user->forgetWorkspaceRole();
        }
        $this->audit($request, 'workspace.create', $workspace, ['name' => $workspace->name, 'onboarding' => $onboarding]);

        return $this->data($workspace->toSummary($activate, 1), 201);
    }

    public function update(Request $request, Workspace $workspace): JsonResponse
    {
        $this->permission($request, 'workspaces.manage');
        $data = $request->validate(['name' => ['required', 'string', 'max:191']]);
        $workspace->update(['name' => trim($data['name'])]);
        $this->audit($request, 'workspace.update', $workspace, ['name' => $workspace->name]);

        return $this->data($workspace->fresh()->toSummary((int) $workspace->id === (int) CurrentWorkspace::forUser($request->user())));
    }

    /** Switching is what makes the rest of the API return the other tenant. */
    public function activate(Request $request, Workspace $workspace): JsonResponse
    {
        $user = $request->user();
        abort_unless(
            $user->isAdmin() || $user->workspaces()->whereKey($workspace->id)->exists(),
            403,
            'You are not a member of that workspace.',
        );
        $user->workspaces()->syncWithoutDetaching([$workspace->id]);
        $user->forceFill(['active_workspace_id' => $workspace->id])->save();
        $this->audit($request, 'workspace.activate', $workspace);

        return $this->data($workspace->loadCount('members')->toSummary(true, (int) $workspace->members_count));
    }

    public function members(Request $request, Workspace $workspace): JsonResponse
    {
        $this->permission($request, 'workspaces.manage');

        return $this->data($workspace->members()->orderBy('first_name')->get()
            ->map(fn (User $member) => $this->userSummary($member))->all());
    }

    public function addMember(Request $request, Workspace $workspace): JsonResponse
    {
        $this->permission($request, 'workspaces.manage');
        $data = $request->validate([
            'user_id' => ['required', Rule::exists('users', 'id')->whereNull('deleted_at')],
        ]);
        $workspace->members()->syncWithoutDetaching([$data['user_id']]);
        $this->audit($request, 'workspace.member.add', $workspace, ['user_id' => (int) $data['user_id']]);

        return $this->data($workspace->loadCount('members')->toSummary(false, (int) $workspace->members_count));
    }

    public function removeMember(Request $request, Workspace $workspace, User $user): JsonResponse
    {
        $this->permission($request, 'workspaces.manage');
        abort_if(
            Workspace::query()->count() <= 1,
            409,
            'This is the only workspace, so its members cannot be removed.',
        );
        $workspace->members()->detach($user->id);
        if ((int) $user->active_workspace_id === (int) $workspace->id) {
            $user->forceFill(['active_workspace_id' => null])->save();
            CurrentWorkspace::forUser($user->fresh());
        }
        $this->audit($request, 'workspace.member.remove', $workspace, ['user_id' => $user->id]);

        return response()->json(null, 204);
    }

}
