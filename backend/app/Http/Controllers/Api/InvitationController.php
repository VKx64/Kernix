<?php

namespace App\Http\Controllers\Api;

use App\Models\Project;
use App\Models\Role;
use App\Models\User;
use App\Models\UserInvitation;
use App\Support\SingleClient;
use App\Support\UserIdentity;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class InvitationController extends ApiController
{
    public function index(Request $request): JsonResponse
    {
        $this->assertAdmin($request);
        // An invitation carries no workspace_id of its own; it is scoped
        // through the role it grants, and `role()` keeps the workspace global
        // scope, so this only matches roles in the caller's own workspace.
        $page = UserInvitation::query()
            ->whereHas('role')
            ->with(['role', 'projects', 'inviter', 'acceptedUser'])
            ->latest()
            ->paginate($this->perPage($request));
        $page->getCollection()->transform(fn (UserInvitation $invitation) => $this->present($invitation));

        return $this->paginated($page);
    }

    public function store(Request $request): JsonResponse
    {
        $this->assertAdmin($request);
        $request->merge(['email' => mb_strtolower(trim((string) $request->input('email')))]);
        $data = $request->validate([
            'email' => ['required', 'email', 'max:191', UserIdentity::uniqueRule()],
            'role_id' => ['required', 'integer', Rule::exists('roles', 'id')->whereNull('deleted_at')],
            'project_ids' => ['required', 'array'],
            'project_ids.*' => [
                'integer',
                'distinct',
                Rule::exists('projects', 'id')->where(fn ($projects) => $projects
                    ->whereNull('archived_at')
                    ->whereNull('deleted_at')),
            ],
            'expires_in_days' => ['sometimes', 'integer', 'between:1,30'],
        ]);

        $projectIds = array_map('intval', $data['project_ids']);
        $rawToken = bin2hex(random_bytes(32));
        $tokenHash = $this->hashToken($rawToken);
        $expiresAt = now()->addDays((int) ($data['expires_in_days'] ?? 7));

        $invitation = DB::transaction(function () use ($request, $data, $projectIds, $tokenHash, $expiresAt): UserInvitation {
            $identityExists = User::withTrashed()
                ->where(fn ($users) => $users
                    ->whereRaw('LOWER(username) = ?', [$data['email']])
                    ->orWhereRaw('LOWER(imagic_email) = ?', [$data['email']])
                    ->orWhereRaw('LOWER(personal_email) = ?', [$data['email']]))
                ->exists();
            if ($identityExists) {
                throw ValidationException::withMessages([
                    'email' => ['This email is already used as a sign-in identity.'],
                ]);
            }

            $activeInviteExists = UserInvitation::query()
                ->where('email', $data['email'])
                ->whereNull('accepted_at')
                ->whereNull('revoked_at')
                ->where('expires_at', '>', now())
                ->lockForUpdate()
                ->exists();
            if ($activeInviteExists) {
                throw ValidationException::withMessages([
                    'email' => ['An active invitation already exists for this email.'],
                ]);
            }

            abort_unless(
                Role::query()->whereKey($data['role_id'])->lockForUpdate()->exists(),
                422,
                'Select an active role.',
            );

            $activeProjects = Project::query()
                ->whereKey($projectIds)
                ->whereNull('archived_at')
                ->whereHas('client', fn ($clients) => $clients->whereNull('archived_at'));
            if (SingleClient::enabled()) {
                $activeProjects->where('client_id', SingleClient::id() ?? 0);
            }
            $activeProjectCount = $projectIds === [] ? 0 : $activeProjects->lockForUpdate()->count();
            if ($activeProjectCount !== count($projectIds)) {
                throw ValidationException::withMessages([
                    'project_ids' => ['Every selected project must still be active.'],
                ]);
            }

            $invitation = UserInvitation::create([
                'email' => $data['email'],
                'token_hash' => $tokenHash,
                'role_id' => $data['role_id'],
                'invited_by' => $request->user()->id,
                'expires_at' => $expiresAt,
            ]);
            $invitation->projects()->attach($projectIds);

            return $invitation;
        }, attempts: 3);

        $this->audit($request, 'invitation.create', $invitation, [
            'email' => $invitation->email,
            'role_id' => $invitation->role_id,
            'project_ids' => $projectIds,
            'expires_at' => $invitation->expires_at,
        ]);

        return $this->data(array_merge($this->present($invitation), [
            'token' => $rawToken,
            'invite_url' => rtrim((string) config('app.frontend_url'), '/').'/invite/'.$rawToken,
        ]), 201);
    }

    public function revoke(Request $request, UserInvitation $invitation): JsonResponse
    {
        $this->assertAdmin($request);
        [$invitation, $changed] = DB::transaction(function () use ($invitation): array {
            $locked = UserInvitation::query()->lockForUpdate()->findOrFail($invitation->id);
            abort_if($locked->accepted_at, 409, 'Accepted invitations cannot be revoked.');
            $changed = ! $locked->revoked_at;
            if ($changed) {
                $locked->update(['revoked_at' => now()]);
            }

            return [$locked, $changed];
        });

        if ($changed) {
            $this->audit($request, 'invitation.revoke', $invitation, [
                'email' => $invitation->email,
                'role_id' => $invitation->role_id,
            ]);
        }

        return $this->data($this->present($invitation));
    }

    private function assertAdmin(Request $request): void
    {
        abort_unless($request->user()->isAdmin(), 403, 'Only an administrator can manage invitations.');
    }

    private function hashToken(string $token): string
    {
        return hash_hmac('sha256', $token, (string) config('app.key'));
    }

    private function present(UserInvitation $invitation): array
    {
        $invitation->loadMissing(['role', 'projects', 'inviter', 'acceptedUser']);

        return [
            'id' => $invitation->id,
            'email' => $invitation->email,
            'status' => $this->status($invitation),
            'role' => $invitation->role ? [
                'id' => $invitation->role->id,
                'name' => $invitation->role->name,
                'key_name' => $invitation->role->key_name,
            ] : null,
            'projects' => $invitation->projects->map(fn (Project $project) => [
                'id' => $project->id,
                'name' => $project->name,
            ])->values()->all(),
            'invited_by' => $this->userSummary($invitation->inviter),
            'accepted_user' => $this->userSummary($invitation->acceptedUser),
            'expires_at' => $invitation->expires_at,
            'accepted_at' => $invitation->accepted_at,
            'revoked_at' => $invitation->revoked_at,
            'created_at' => $invitation->created_at,
        ];
    }

    private function status(UserInvitation $invitation): string
    {
        if ($invitation->accepted_at) {
            return 'accepted';
        }
        if ($invitation->revoked_at) {
            return 'revoked';
        }
        if ($invitation->expires_at->isPast()) {
            return 'expired';
        }

        return 'pending';
    }
}
