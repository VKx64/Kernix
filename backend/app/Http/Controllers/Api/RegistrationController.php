<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\Role;
use App\Models\User;
use App\Models\UserInvitation;
use App\Models\Workspace;
use App\Support\UserIdentity;
use App\Support\WorkspaceProvisioner;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;

/**
 * Public sign-up. Two shapes:
 *
 * - with an invitation token the account joins that invitation's workspace with
 *   the role the invitation carries, and onboarding is already done;
 * - without one the account is created with no workspace at all, and the client
 *   sends it to onboarding, which is the only other thing it may reach.
 */
class RegistrationController extends ApiController
{
    public function store(Request $request): JsonResponse
    {
        $request->merge([
            'name' => trim((string) $request->input('name')),
            'email' => mb_strtolower(trim((string) $request->input('email'))),
        ]);
        $data = $request->validate([
            'name' => ['required', 'string', 'max:128'],
            'email' => ['required', 'string', 'email', 'max:191', UserIdentity::uniqueRule()],
            'password' => ['required', 'string', 'max:255', 'confirmed', Password::defaults()],
            'invitation_token' => ['sometimes', 'nullable', 'string', 'regex:/^[A-Fa-f0-9]{64}$/'],
        ]);

        [$firstName, $lastName] = $this->splitName($data['name']);
        $token = $data['invitation_token'] ?? null;

        $user = $token
            ? $this->joinByInvitation($request, $token, $data, $firstName, $lastName)
            : $this->registerWithoutWorkspace($data, $firstName, $lastName);

        Auth::guard('web')->login($user);
        $request->session()->regenerate();

        return $this->noStore($this->data($this->presentUser($user->fresh()), 201));
    }

    private function registerWithoutWorkspace(array $data, string $firstName, string $lastName): User
    {
        return User::withoutAutomaticWorkspace(fn (): User => User::create([
            'role_id' => null,
            'username' => $data['email'],
            'password_hash' => Hash::make($data['password']),
            'first_name' => $firstName,
            'last_name' => $lastName,
            'imagic_email' => $data['email'],
            'status' => 'active',
        ]));
    }

    private function joinByInvitation(Request $request, string $token, array $data, string $firstName, string $lastName): User
    {
        return DB::transaction(function () use ($request, $token, $data, $firstName, $lastName): User {
            $invitation = UserInvitation::query()
                ->where('token_hash', $this->hashToken($token))
                ->lockForUpdate()
                ->first();
            $this->assertUsable($invitation);

            if (mb_strtolower(trim((string) $invitation->email)) !== $data['email']) {
                $this->rejectInvitation('Register with the email address the invitation was sent to.');
            }

            $role = Role::acrossWorkspaces()->whereKey($invitation->role_id)->first();
            $workspace = $role?->workspace_id
                ? Workspace::query()->whereKey($role->workspace_id)->first()
                : null;
            if (! $role || ! $workspace) {
                $this->rejectInvitation();
            }

            $user = User::withoutAutomaticWorkspace(fn (): User => User::create([
                'role_id' => $role->getKey(),
                'username' => $data['email'],
                'password_hash' => Hash::make($data['password']),
                'first_name' => $firstName,
                'last_name' => $lastName,
                'imagic_email' => $invitation->email,
                'status' => 'active',
            ]));
            WorkspaceProvisioner::join($workspace, $user, $role);

            $projectIds = DB::table('invitation_project')
                ->where('user_invitation_id', $invitation->id)
                ->orderBy('project_id')
                ->pluck('project_id')
                ->map(fn ($id): int => (int) $id)
                ->all();
            if ($projectIds !== []) {
                $user->projects()->attach($projectIds, ['assigned_by' => $invitation->invited_by]);
            }

            $invitation->update(['accepted_at' => now(), 'accepted_user_id' => $user->id]);

            AuditLog::create([
                'user_id' => $user->id,
                'action' => 'registration.invitation',
                'entity_type' => class_basename($invitation),
                'entity_id' => $invitation->id,
                'summary' => 'registration.invitation UserInvitation',
                'changes_json' => [
                    'accepted_user_id' => $user->id,
                    'workspace_id' => $workspace->getKey(),
                    'role_id' => $role->getKey(),
                    'project_ids' => $projectIds,
                ],
                'ip_address' => $request->ip(),
                'user_agent' => mb_substr((string) $request->userAgent(), 0, 500),
            ]);

            return $user;
        }, attempts: 3);
    }

    /**
     * An expired, revoked, or already-used token is refused outright. Falling
     * through to the no-invitation path would silently create a stranded
     * account instead of telling the person what went wrong.
     */
    private function assertUsable(?UserInvitation $invitation): void
    {
        if (! $invitation || $invitation->accepted_at || $invitation->revoked_at || $invitation->expires_at?->isPast()) {
            $this->rejectInvitation();
        }
    }

    private function rejectInvitation(string $message = 'This invitation is invalid or no longer available.'): never
    {
        throw ValidationException::withMessages(['invitation_token' => [$message]]);
    }

    /** @return array{0: string, 1: string} */
    private function splitName(string $name): array
    {
        $parts = preg_split('/\s+/', $name, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $first = (string) array_shift($parts);

        return [Str::limit($first, 64, ''), Str::limit(implode(' ', $parts), 64, '')];
    }

    private function hashToken(string $token): string
    {
        return hash_hmac('sha256', $token, (string) config('app.key'));
    }

    /** @return array<string, mixed> */
    private function presentUser(User $user): array
    {
        $user->load(['role.permissions', 'department']);
        $data = $user->toArray();
        $data['name'] = trim($user->first_name.' '.$user->last_name);
        $data['permissions'] = $user->permissions();
        $data['is_admin'] = $user->isAdmin();
        $data['can_admin_override'] = $user->isAdmin();
        $data['needs_workspace'] = $user->needsWorkspace();

        return $data;
    }

    private function noStore(JsonResponse $response): JsonResponse
    {
        $response->headers->set('Cache-Control', 'no-store, private');
        $response->headers->set('Pragma', 'no-cache');

        return $response;
    }
}
