<?php

namespace App\Http\Controllers\Api;

use App\Models\Role;
use App\Models\User;
use App\Support\CurrentWorkspace;
use App\Support\UserIdentity;
use App\Support\UserSessionRevoker;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;

class UserController extends ApiController
{
    public function index(Request $request): JsonResponse
    {
        $this->permission($request, 'users.view');
        $query = $this->archived(
            User::query()->inWorkspace(CurrentWorkspace::forUser($request->user()))->with(['role.permissions', 'department']),
            $request,
        );
        if ($search = $request->string('search')->trim()->toString()) {
            $query->where(fn ($user) => $user->where('username', 'like', "%{$search}%")
                ->orWhere('first_name', 'like', "%{$search}%")
                ->orWhere('last_name', 'like', "%{$search}%")
                ->orWhere('imagic_email', 'like', "%{$search}%"));
        }
        if ($request->filled('role_id')) {
            $query->where('role_id', $request->integer('role_id'));
        }
        if ($request->filled('status')) {
            $query->where('status', $request->string('status'));
        }
        $page = $query->orderBy('first_name')->orderBy('last_name')->paginate($this->perPage($request));
        $private = $request->user()->isAdmin();
        $page->getCollection()->transform(fn (User $user) => $this->present($user, $private));

        return $this->paginated($page);
    }

    public function store(Request $request): JsonResponse
    {
        $this->permission($request, 'users.create');
        $data = $this->validated($request);
        $this->assertPrivateFieldAccess($request, $data);
        $this->assertRoleAssignable($request, (int) $data['role_id']);
        $data['last_name'] = (string) ($data['last_name'] ?? '');
        $password = $data['password'];
        unset($data['password'], $data['password_confirmation']);
        $user = User::create($data + ['password_hash' => Hash::make($password)]);
        $this->audit($request, 'user.create', $user, $data);

        return $this->data($this->present($user, $request->user()->isAdmin()), 201);
    }

    public function show(Request $request, User $user): JsonResponse
    {
        $this->permission($request, 'users.view');
        $this->assertInWorkspace($user);

        return $this->data($this->present($user, $request->user()->isAdmin()));
    }

    public function update(Request $request, User $user): JsonResponse
    {
        $this->permission($request, 'users.edit');
        $this->assertInWorkspace($user);
        $this->assertAdminTargetMutable($request, $user);
        $data = $this->validated($request, true, $user);
        $this->assertPrivateFieldAccess($request, $data);
        $this->assertPasswordResetAccess($request, $data);
        if (isset($data['role_id'])) {
            $this->assertRoleAssignable($request, (int) $data['role_id'], $user);
        }
        if ((int) $request->user()->id === (int) $user->id && ! $request->user()->isAdmin()
            && (array_key_exists('role_id', $data) || array_key_exists('status', $data))) {
            abort(403, 'You cannot change your own role or account status.');
        }
        if (array_key_exists('last_name', $data)) {
            $data['last_name'] = (string) ($data['last_name'] ?? '');
        }
        $this->assertAdminContinuity($user, $data);
        if (($data['status'] ?? $user->status) !== 'active') {
            $this->assertNoActiveWork($user);
        }
        $passwordChanged = filled($data['password'] ?? null);
        if ($passwordChanged) {
            $data['password_hash'] = Hash::make($data['password']);
        }
        unset($data['password'], $data['password_confirmation']);
        $before = $user->getAttributes();
        $user->update($data);
        if ($user->status !== 'active') {
            $this->closeOpenTime($user);
        }
        if ($passwordChanged || ($data['status'] ?? 'active') !== 'active' || array_key_exists('role_id', $data)) {
            $this->revokeSessions($user);
        }
        $this->audit($request, 'user.update', $user, ['before' => $before, 'after' => $user->getAttributes()]);

        return $this->data($this->present($user->fresh(), $request->user()->isAdmin()));
    }

    public function archive(Request $request, User $user): JsonResponse
    {
        $this->permission($request, 'users.archive');
        $this->assertInWorkspace($user);
        $this->assertNotSelf($request, $user);
        $this->assertAdminTargetMutable($request, $user);
        $this->assertAdminContinuity($user, ['status' => 'inactive']);
        $this->assertNoActiveWork($user);
        $user->update(['archived_at' => now(), 'status' => 'inactive']);
        $this->closeOpenTime($user);
        $this->revokeSessions($user);
        $this->audit($request, 'user.archive', $user);

        return $this->data($this->present($user, $request->user()->isAdmin()));
    }

    public function restore(Request $request, int $user): JsonResponse
    {
        $this->permission($request, 'users.archive');
        $model = User::findOrFail($user);
        $this->assertInWorkspace($model);
        $this->assertAdminTargetMutable($request, $model);
        $model->update(['archived_at' => null, 'status' => 'active']);
        $this->audit($request, 'user.restore', $model);

        return $this->data($this->present($model, $request->user()->isAdmin()));
    }

    private function validated(Request $request, bool $partial = false, ?User $user = null): array
    {
        return $request->validate([
            'role_id' => [$partial ? 'sometimes' : 'required', 'integer', Rule::exists('roles', 'id')->whereNull('deleted_at')],
            'username' => [$partial ? 'sometimes' : 'required', 'string', 'max:128', Rule::unique('users', 'username')->ignore($user?->id), UserIdentity::uniqueRule($user)],
            'password' => [$partial ? 'sometimes' : 'required', 'nullable', 'string', 'min:8', 'max:255', 'confirmed'],
            'first_name' => [$partial ? 'sometimes' : 'required', 'string', 'max:64'],
            'last_name' => ['sometimes', 'nullable', 'string', 'max:64'],
            'imagic_email' => ['sometimes', 'nullable', 'email', 'max:191', UserIdentity::uniqueRule($user)],
            'personal_email' => ['sometimes', 'nullable', 'email', 'max:191', UserIdentity::uniqueRule($user)],
            'phone_1' => ['sometimes', 'nullable', 'string', 'max:64'], 'phone_2' => ['sometimes', 'nullable', 'string', 'max:64'],
            'department_value_id' => ['sometimes', 'nullable', $this->fieldValueRule('user_department')],
            'wise_account' => ['sometimes', 'nullable', 'string', 'max:191'], 'gcash_account' => ['sometimes', 'nullable', 'string', 'max:191'],
            'start_date' => ['sometimes', 'nullable', 'date'], 'birthdate' => ['sometimes', 'nullable', 'date', 'before:today'],
            'status' => ['sometimes', Rule::in(['active', 'inactive'])],
            'home_address' => ['sometimes', 'nullable', 'string'], 'barangay' => ['sometimes', 'nullable', 'string', 'max:128'],
            'city' => ['sometimes', 'nullable', 'string', 'max:128'], 'province' => ['sometimes', 'nullable', 'string', 'max:128'],
            'zip_code' => ['sometimes', 'nullable', 'string', 'max:32'], 'timezone' => ['sometimes', 'nullable', 'timezone'],
            // profile_image is written only by the avatar endpoints.
            'theme_preset' => ['sometimes', 'string', 'max:64'],
            'password_hash' => ['prohibited'], 'remember_token' => ['prohibited'],
        ]);
    }

    private function assertNotSelf(Request $request, User $user): void
    {
        abort_if((int) $request->user()->id === (int) $user->id, 409, 'You cannot archive or delete your own account.');
    }

    /**
     * A user id from another tenant is treated the same as one that does not
     * exist — a 404, not a 403 — so route-guessing cannot even confirm another
     * workspace's account is there.
     */
    private function assertInWorkspace(User $user): void
    {
        abort_unless($user->belongsToCurrentWorkspace(), 404);
    }

    private function assertRoleAssignable(Request $request, int $roleId, ?User $target = null): void
    {
        $role = Role::findOrFail($roleId);
        if ($request->user()->isAdmin()) {
            return;
        }

        if ($target) {
            abort_unless((int) $role->id === (int) $target->role_id, 403, 'Only an administrator can change a user role.');

            return;
        }

        abort_unless((int) $role->id === (int) $request->user()->role_id, 403, 'Only an administrator can assign another role.');
    }

    private function assertAdminTargetMutable(Request $request, User $user): void
    {
        $user->loadMissing('role');
        abort_if($user->isAdmin() && ! $request->user()->isAdmin(), 403, 'Only an administrator can change an administrator account.');
    }

    private function assertPasswordResetAccess(Request $request, array $data): void
    {
        if (filled($data['password'] ?? null)) {
            abort_unless($request->user()->isAdmin(), 403, 'Only an administrator can reset another user password. Use your profile to change your own password.');
        }
    }

    private function assertPrivateFieldAccess(Request $request, array $data): void
    {
        $privateFields = array_intersect(array_keys($data), User::PRIVATE_FIELDS);
        abort_if($privateFields && ! $request->user()->isAdmin(), 403, 'Only an administrator can change private user details.');
    }

    private function assertAdminContinuity(User $user, array $changes): void
    {
        $user->loadMissing('role');
        if (! $user->isAdmin()) {
            return;
        }
        $nextRole = isset($changes['role_id']) ? Role::find($changes['role_id']) : $user->role;
        $remainsAdmin = $nextRole?->key_name === 'admin'
            && ($changes['status'] ?? $user->status) === 'active'
            && ! ($changes['archived_at'] ?? $user->archived_at);
        if (! $remainsAdmin) {
            $otherAdmins = User::query()->whereKeyNot($user->id)->where('status', 'active')->whereNull('archived_at')
                ->whereHas('role', fn ($role) => $role->where('key_name', 'admin'))->exists();
            abort_unless($otherAdmins, 409, 'At least one active administrator must remain.');
        }
    }

    private function revokeSessions(User $user): void
    {
        UserSessionRevoker::forUser($user);
    }

    private function closeOpenTime(User $user): void
    {
        DB::transaction(function () use ($user): void {
            $closedAt = now();
            $sessionIds = DB::table('time_sessions')
                ->where('user_id', $user->id)
                ->whereNull('clock_out_at')
                ->lockForUpdate()
                ->pluck('id');
            if ($sessionIds->isEmpty()) {
                return;
            }

            DB::table('time_breaks')->whereIn('session_id', $sessionIds)->whereNull('end_at')->update([
                'end_at' => $closedAt,
                'updated_at' => $closedAt,
            ]);
            DB::table('time_sessions')->whereIn('id', $sessionIds)->update([
                'clock_out_at' => $closedAt,
                'updated_at' => $closedAt,
            ]);
        });
    }

    private function assertNoActiveWork(User $user): void
    {
        $managesProjects = DB::table('projects')
            ->join('clients', 'clients.id', '=', 'projects.client_id')
            ->where('projects.manager_user_id', $user->id)
            ->whereNull('projects.archived_at')
            ->whereNull('projects.deleted_at')
            ->whereNull('clients.archived_at')
            ->whereNull('clients.deleted_at')
            ->exists();
        $ownsTasks = DB::table('tasks')
            ->join('projects', 'projects.id', '=', 'tasks.project_id')
            ->join('clients', 'clients.id', '=', 'projects.client_id')
            ->where('tasks.assignee_user_id', $user->id)
            ->whereNull('tasks.archived_at')
            ->whereNull('tasks.deleted_at')
            ->whereNull('projects.archived_at')
            ->whereNull('projects.deleted_at')
            ->whereNull('clients.archived_at')
            ->whereNull('clients.deleted_at')
            ->exists();
        $ownsSubtasks = DB::table('task_subtasks')
            ->join('tasks', 'tasks.id', '=', 'task_subtasks.task_id')
            ->join('projects', 'projects.id', '=', 'tasks.project_id')
            ->join('clients', 'clients.id', '=', 'projects.client_id')
            ->where('task_subtasks.assignee_user_id', $user->id)
            ->whereNull('task_subtasks.completed_at')
            ->whereNull('task_subtasks.deleted_at')
            ->whereNull('tasks.archived_at')
            ->whereNull('tasks.deleted_at')
            ->whereNull('projects.archived_at')
            ->whereNull('projects.deleted_at')
            ->whereNull('clients.archived_at')
            ->whereNull('clients.deleted_at')
            ->exists();

        abort_if($managesProjects || $ownsTasks || $ownsSubtasks, 409, 'Reassign this user active projects, tasks, and subtasks before disabling the account.');
    }

    private function present(User $user, bool $private): array
    {
        $user->load(['role.permissions', 'department']);
        if ($private) {
            $user->makeVisible(User::PRIVATE_FIELDS);
        }
        $data = $user->toArray();
        $data['name'] = trim($user->first_name.' '.$user->last_name);
        $data['permissions'] = $user->permissions();
        $data['is_admin'] = $user->isAdmin();

        return $data;
    }
}
