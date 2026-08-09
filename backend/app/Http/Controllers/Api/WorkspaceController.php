<?php

namespace App\Http\Controllers\Api;

use App\Models\User;
use App\Models\Workspace;
use App\Support\CurrentWorkspace;
use App\Support\WorkspaceFeatureBlockers;
use App\Support\WorkspaceFeatures;
use App\Support\WorkspaceProvisioner;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class WorkspaceController extends ApiController
{
    /**
     * Every signed-in user sees the workspaces they belong to, full stop.
     * `isAdmin()` only means "administrator of the workspace I'm currently
     * in" — it is not a platform-wide role, so it must never widen this past
     * the caller's own memberships or it hands out every tenant's name and
     * headcount to whoever runs one workspace.
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $activeId = CurrentWorkspace::forUser($user);
        $workspaces = $user->workspaces()->getQuery()
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
        $this->assertMember($request, $workspace);
        $this->permission($request, 'workspaces.manage');
        $data = $request->validate(['name' => ['required', 'string', 'max:191']]);
        $workspace->update(['name' => trim($data['name'])]);
        $this->audit($request, 'workspace.update', $workspace, ['name' => $workspace->name]);

        return $this->data($workspace->fresh()->toSummary((int) $workspace->id === (int) CurrentWorkspace::forUser($request->user())));
    }

    /**
     * Switching is what makes the rest of the API return the other tenant, so
     * membership is the only thing that can unlock it — administering one
     * workspace grants nothing in another.
     */
    public function activate(Request $request, Workspace $workspace): JsonResponse
    {
        $user = $request->user();
        abort_unless(
            $user->workspaces()->whereKey($workspace->id)->exists(),
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
        $this->assertMember($request, $workspace);
        $this->permission($request, 'workspaces.manage');

        return $this->data($workspace->members()->orderBy('first_name')->get()
            ->map(fn (User $member) => $this->userSummary($member))->all());
    }

    public function addMember(Request $request, Workspace $workspace): JsonResponse
    {
        $this->assertMember($request, $workspace);
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
        $this->assertMember($request, $workspace);
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

    /** The catalog only — no counts, so opening the settings page is always cheap. */
    public function features(Request $request, Workspace $workspace): JsonResponse
    {
        $this->assertMember($request, $workspace);
        $this->permission($request, 'workspaces.manage');

        return $this->data(['features' => WorkspaceFeatures::catalog($workspace)]);
    }

    /**
     * Turning a feature off with data still behind it is a 409 with the
     * blockers that would be affected, unless `force` is set — which skips
     * only the count check, never the write path below it. The write is a
     * single `update()` of intersected boolean columns: nothing here can
     * delete, archive, or detach anything, however the request is shaped.
     *
     * Any registry key can be toggled here, not only a RENDERED one — the
     * settings screen only controls which switches are *visible*, not which
     * ones are enforceable. Clients and Projects are toggled this way before
     * their own switch ships.
     */
    public function updateFeatures(Request $request, Workspace $workspace): JsonResponse
    {
        $this->assertMember($request, $workspace);
        $this->permission($request, 'workspaces.manage');
        $data = $request->validate([
            'features' => ['required', 'array'],
            'features.*' => ['boolean'],
            'force' => ['sometimes', 'boolean'],
        ]);
        $force = (bool) ($data['force'] ?? false);
        $requested = array_intersect_key($data['features'], array_flip(WorkspaceFeatures::keys()));

        // What every key would end up as if this request went through as
        // asked, before any blocker check or cascade — used only to validate
        // "requires" edges against each other in the same request.
        $effective = [];
        foreach (WorkspaceFeatures::keys() as $key) {
            $effective[$key] = array_key_exists($key, $requested) ? (bool) $requested[$key] : WorkspaceFeatures::enabled($workspace, $key);
        }
        foreach ($requested as $key => $value) {
            if (! $value) {
                continue;
            }
            foreach (WorkspaceFeatures::requires($key) as $required) {
                abort_if(
                    ! ($effective[$required] ?? true),
                    422,
                    WorkspaceFeatures::label($key).' requires '.WorkspaceFeatures::label($required).' to be turned on first.',
                );
            }
        }

        // A feature cannot stay on once something it requires goes off, so
        // turning clients off also turns contacts off in the same write —
        // never a data change, only these flags.
        $cascaded = [];
        $changed = true;
        while ($changed) {
            $changed = false;
            foreach (WorkspaceFeatures::keys() as $key) {
                if (! $effective[$key]) {
                    continue;
                }
                foreach (WorkspaceFeatures::requires($key) as $required) {
                    if (! $effective[$required]) {
                        $effective[$key] = false;
                        $cascaded[$key] = false;
                        $changed = true;
                    }
                }
            }
        }

        [$blockers, $dependentFeatures] = CurrentWorkspace::use($workspace->id, function () use ($workspace, $requested) {
            $blockers = [];
            $dependentFeatures = [];
            foreach ($requested as $key => $value) {
                if (WorkspaceFeatures::enabled($workspace, $key) && ! $value) {
                    $blockers = array_merge($blockers, WorkspaceFeatureBlockers::for($workspace, $key));
                    $dependentFeatures = array_merge($dependentFeatures, WorkspaceFeatureBlockers::dependentFeatures($workspace, $key));
                }
            }

            return [$blockers, array_values(array_unique($dependentFeatures))];
        });
        if ($blockers !== [] && ! $force) {
            return response()->json([
                'message' => 'This feature still has data behind it.',
                'code' => 'FEATURE_HAS_DEPENDENT_DATA',
                'blockers' => $blockers,
                'dependent_features' => $dependentFeatures,
            ], 409);
        }

        $incoming = $requested + $cascaded;
        $turningOn = [];
        foreach ($incoming as $key => $value) {
            if ($value && ! WorkspaceFeatures::enabled($workspace, $key)) {
                $turningOn[] = $key;
            }
        }

        $updates = [];
        foreach ($incoming as $key => $value) {
            $updates[WorkspaceFeatures::enabledColumn($key)] = (bool) $value;
        }
        $workspace->update($updates);

        if ($turningOn !== []) {
            CurrentWorkspace::use($workspace->id, function () use ($workspace, $turningOn) {
                foreach ($turningOn as $key) {
                    WorkspaceProvisioner::revealDefaultRowsIfUsed($workspace, $key);
                }
            });
        }

        $this->audit($request, 'workspace.features.update', $workspace, $updates);

        return $this->data(['features' => WorkspaceFeatures::catalog($workspace->fresh())]);
    }

    /**
     * `workspaces.manage` is granted per workspace, so holding it in the
     * caller's own tenant says nothing about a workspace they were not
     * invited into. Every route that takes an arbitrary {workspace} has to
     * check membership before the permission means anything.
     */
    private function assertMember(Request $request, Workspace $workspace): void
    {
        abort_unless(
            $request->user()->workspaces()->whereKey($workspace->id)->exists(),
            404,
        );
    }

}
