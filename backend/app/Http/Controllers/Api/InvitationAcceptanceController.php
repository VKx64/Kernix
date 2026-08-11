<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\Project;
use App\Models\Role;
use App\Models\User;
use App\Models\UserInvitation;
use App\Models\Workspace;
use App\Support\SingleClient;
use App\Support\UserIdentity;
use App\Support\WorkspaceProvisioner;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class InvitationAcceptanceController extends ApiController
{
    public function preview(string $token): JsonResponse
    {
        $invitation = $this->findInvitation($token);
        $this->assertAvailable($invitation);
        [$role, $projects] = $this->activeDependencies($invitation);

        return $this->noStore($this->data([
            'email' => $invitation->email,
            'role' => [
                'id' => $role->id,
                'name' => $role->name,
                'key_name' => $role->key_name,
            ],
            'projects' => $projects->map(fn (Project $project) => [
                'id' => $project->id,
                'name' => $project->name,
            ])->values()->all(),
            'expires_at' => $invitation->expires_at,
        ]));
    }

    public function accept(Request $request, string $token): JsonResponse
    {
        $this->assertAvailable($this->findInvitation($token));
        $request->merge([
            'username' => trim((string) $request->input('username')),
            'first_name' => trim((string) $request->input('first_name')),
            'last_name' => $request->input('last_name') === null
                ? null
                : trim((string) $request->input('last_name')),
        ]);
        $data = $request->validate([
            'first_name' => ['required', 'string', 'max:64'],
            'last_name' => ['sometimes', 'nullable', 'string', 'max:64'],
            'username' => [
                'required',
                'string',
                'max:128',
                Rule::unique('users', 'username'),
                UserIdentity::uniqueRule(),
            ],
            'password' => ['required', 'string', 'min:8', 'max:255', 'confirmed'],
            'email' => ['prohibited'],
            'role_id' => ['prohibited'],
            'project_id' => ['prohibited'],
            'project_ids' => ['prohibited'],
        ]);

        $tokenHash = $this->hashToken($token);
        $user = DB::transaction(function () use ($request, $data, $tokenHash): User {
            $invitation = UserInvitation::query()
                ->where('token_hash', $tokenHash)
                ->lockForUpdate()
                ->first();
            abort_unless($invitation, 410, 'This invitation is invalid or no longer available.');
            $this->assertAvailable($invitation);
            [$role, $projects, $projectIds] = $this->activeDependencies($invitation, true);
            $workspace = $this->invitedWorkspace($role);

            $this->assertIdentityAvailable($data['username'], 'username');
            $this->assertIdentityAvailable($invitation->email, 'email');

            // The invite link is opened while signed out, so there is no current
            // workspace for the automatic assignment in User::booted() to read;
            // left to itself it would drop the account into the lowest-id
            // workspace instead of the one that invited them. The invitation's
            // role carries the right workspace, so join through it explicitly.
            $user = User::withoutAutomaticWorkspace(fn (): User => User::create([
                'role_id' => $role->id,
                'username' => $data['username'],
                'password_hash' => Hash::make($data['password']),
                'first_name' => $data['first_name'],
                'last_name' => (string) ($data['last_name'] ?? ''),
                'imagic_email' => $invitation->email,
                'status' => 'active',
            ]));
            WorkspaceProvisioner::join($workspace, $user, $role);
            if ($projectIds !== []) {
                $user->projects()->attach($projectIds, ['assigned_by' => $invitation->invited_by]);
            }
            $invitation->update([
                'accepted_at' => now(),
                'accepted_user_id' => $user->id,
            ]);

            AuditLog::create([
                'user_id' => $user->id,
                'action' => 'invitation.accept',
                'entity_type' => class_basename($invitation),
                'entity_id' => $invitation->id,
                'summary' => 'invitation.accept UserInvitation',
                'changes_json' => [
                    'accepted_user_id' => $user->id,
                    'role_id' => $role->id,
                    'project_ids' => $projectIds,
                ],
                'ip_address' => $request->ip(),
                'user_agent' => mb_substr((string) $request->userAgent(), 0, 500),
            ]);

            return $user;
        }, attempts: 3);

        Auth::guard('web')->login($user);
        $request->session()->regenerate();

        return $this->noStore($this->data($this->presentUser($user), 201));
    }

    private function findInvitation(string $token): UserInvitation
    {
        $invitation = UserInvitation::query()->where('token_hash', $this->hashToken($token))->first();
        abort_unless($invitation, 410, 'This invitation is invalid or no longer available.');

        return $invitation;
    }

    private function assertAvailable(UserInvitation $invitation): void
    {
        abort_if(
            $invitation->accepted_at || $invitation->revoked_at || $invitation->expires_at->isPast(),
            410,
            'This invitation is invalid or no longer available.',
        );
    }

    /** @return array{0: Role, 1: Collection<int, Project>, 2?: array<int, int>} */
    private function activeDependencies(UserInvitation $invitation, bool $lock = false): array
    {
        $roleQuery = Role::acrossWorkspaces()->whereKey($invitation->role_id);
        if ($lock) {
            $roleQuery->lockForUpdate();
        }
        $role = $roleQuery->first();
        abort_unless($role, 410, 'This invitation is invalid or no longer available.');

        $projectIds = DB::table('invitation_project')
            ->where('user_invitation_id', $invitation->id)
            ->orderBy('project_id')
            ->pluck('project_id')
            ->map(fn ($id) => (int) $id)
            ->all();
        $projectsQuery = Project::query()
            ->whereKey($projectIds)
            ->whereNull('archived_at')
            ->whereHas('client', fn ($clients) => $clients->whereNull('archived_at'))
            ->orderBy('name');
        if (SingleClient::enabled()) {
            $projectsQuery->where('client_id', SingleClient::id() ?? 0);
        }
        if ($lock) {
            $projectsQuery->lockForUpdate();
        }
        $projects = $projectsQuery->get();
        abort_if($projects->count() !== count($projectIds), 410, 'This invitation is invalid or no longer available.');

        return [$role, $projects, $projectIds];
    }

    /**
     * The workspace the invitation belongs to. An invitation carries no
     * workspace of its own, so it is read off the role it grants.
     */
    private function invitedWorkspace(Role $role): Workspace
    {
        $workspace = $role->workspace_id
            ? Workspace::query()->whereKey($role->workspace_id)->first()
            : null;
        abort_unless($workspace, 410, 'This invitation is invalid or no longer available.');

        return $workspace;
    }

    private function assertIdentityAvailable(string $identity, string $field): void
    {
        $normalized = mb_strtolower(trim($identity));
        $exists = User::withTrashed()
            ->where(fn ($users) => $users
                ->whereRaw('LOWER(username) = ?', [$normalized])
                ->orWhereRaw('LOWER(imagic_email) = ?', [$normalized])
                ->orWhereRaw('LOWER(personal_email) = ?', [$normalized]))
            ->exists();
        if ($exists) {
            throw ValidationException::withMessages([
                $field => ["The {$field} is already used as a sign-in identity."],
            ]);
        }
    }

    private function hashToken(string $token): string
    {
        return hash_hmac('sha256', $token, (string) config('app.key'));
    }

    private function presentUser(User $user): array
    {
        $user->load(['role.permissions', 'department']);
        $user->makeVisible(User::PRIVATE_FIELDS);
        $data = $user->toArray();
        $data['name'] = trim($user->first_name.' '.$user->last_name);
        $data['permissions'] = $user->permissions();
        $data['is_admin'] = $user->isAdmin();
        $data['can_admin_override'] = $user->isAdmin();

        return $data;
    }

    private function noStore(JsonResponse $response): JsonResponse
    {
        $response->headers->set('Cache-Control', 'no-store, private');
        $response->headers->set('Pragma', 'no-cache');

        return $response;
    }
}
