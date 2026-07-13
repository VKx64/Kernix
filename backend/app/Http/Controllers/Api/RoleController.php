<?php

namespace App\Http\Controllers\Api;

use App\Models\Role;
use App\Models\User;
use App\Support\PermissionCatalog;
use App\Support\UserSessionRevoker;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class RoleController extends ApiController
{
    public function index(Request $request): JsonResponse
    {
        $this->permission($request, 'roles.view');
        $query = Role::query()->with('permissions')->withCount(['users' => fn ($users) => $users->whereNull('archived_at')]);
        if ($search = $request->string('search')->trim()->toString()) {
            $query->where('name', 'like', "%{$search}%");
        }
        $page = $query->orderBy('sort_order')->orderBy('name')->paginate($this->perPage($request));
        $page->getCollection()->transform(fn (Role $role) => $this->present($role));

        return $this->paginated($page);
    }

    public function store(Request $request): JsonResponse
    {
        $this->assertAdmin($request);
        $data = $this->validated($request);
        $permissions = $data['permissions'] ?? [];
        unset($data['permissions']);
        $data['key_name'] ??= Str::slug($data['name'], '_');
        if (! $data['key_name'] || Role::withTrashed()->where('key_name', $data['key_name'])->exists()) {
            throw ValidationException::withMessages(['name' => ['Choose a distinct role name.']]);
        }
        $role = DB::transaction(function () use ($data, $permissions) {
            $role = Role::create($data + ['is_system' => false, 'sort_order' => 99]);
            $role->permissions()->createMany(array_map(fn ($key) => ['permission_key' => $key], $permissions));

            return $role;
        });
        $this->audit($request, 'role.create', $role, $data + ['permissions' => $permissions]);

        return $this->data($this->present($role), 201);
    }

    public function show(Request $request, Role $role): JsonResponse
    {
        $this->permission($request, 'roles.view');

        return $this->data($this->present($role));
    }

    public function update(Request $request, Role $role): JsonResponse
    {
        $this->assertAdmin($request);
        abort_if($role->is_system, 409, 'System roles cannot be changed.');
        $beforePermissions = $role->permissions()->pluck('permission_key')->sort()->values()->all();
        $data = $this->validated($request, true, $role);
        $permissions = $data['permissions'] ?? null;
        unset($data['permissions']);
        DB::transaction(function () use ($role, $data, $permissions) {
            $role->update($data);
            if ($permissions !== null) {
                $role->permissions()->delete();
                $role->permissions()->createMany(array_map(fn ($key) => ['permission_key' => $key], $permissions));
            }
        });
        $afterPermissions = $permissions === null
            ? $beforePermissions
            : collect($permissions)->sort()->values()->all();
        $permissionsChanged = $beforePermissions !== $afterPermissions;
        $affectedUsers = $permissionsChanged ? UserSessionRevoker::forRole($role) : 0;
        $this->audit($request, 'role.update', $role, $data + ($permissions === null ? [] : ['permissions' => $permissions]));
        if ($permissionsChanged) {
            $this->audit($request, 'role.permissions_changed', $role, [
                'before' => $beforePermissions,
                'after' => $afterPermissions,
            ]);
            $this->audit($request, 'role.sessions_revoked', $role, ['affected_users' => $affectedUsers]);
        }

        return $this->data(array_merge($this->present($role->fresh()), [
            'affected_users_count' => $affectedUsers,
            'sessions_revoked' => $permissionsChanged,
        ]));
    }

    public function destroy(Request $request, Role $role): JsonResponse
    {
        $this->assertAdmin($request);
        abort_if($role->is_system, 409, 'System roles cannot be deleted.');
        abort_if($role->users()->exists(), 409, 'Move users to another role before deleting this role.');
        $role->delete();
        $this->audit($request, 'role.delete', $role);

        return response()->json(null, 204);
    }

    public function permissions(Request $request): JsonResponse
    {
        $this->permission($request, 'roles.view');

        return $this->data(PermissionCatalog::groups());
    }

    private function validated(Request $request, bool $partial = false, ?Role $role = null): array
    {
        $data = $request->validate([
            'name' => [$partial ? 'sometimes' : 'required', 'string', 'max:128'],
            'key_name' => ['sometimes', 'string', 'max:128', 'regex:/^[a-z0-9_]+$/', Rule::unique('roles', 'key_name')->ignore($role?->id)],
            'permissions' => [$partial ? 'sometimes' : 'required', 'array'],
            'permissions.*' => ['string', 'distinct', Rule::in(PermissionCatalog::keys())],
            'is_system' => ['prohibited'],
        ]);

        if (array_key_exists('permissions', $data)) {
            $permissions = $data['permissions'];
            if (! in_array('dashboard.view', $permissions, true)) {
                throw ValidationException::withMessages([
                    'permissions' => ['Every custom role must include dashboard.view.'],
                ]);
            }

            $missing = PermissionCatalog::missingDependencies($permissions);
            if ($missing !== []) {
                $messages = collect($missing)->map(
                    fn (array $dependencies, string $key): string => $key.' requires '.implode(', ', $dependencies).'.'
                )->values()->all();
                throw ValidationException::withMessages(['permissions' => $messages]);
            }
        }

        return $data;
    }

    private function assertAdmin(Request $request): void
    {
        abort_unless($request->user()->isAdmin(), 403, 'Only an administrator can change roles and permissions.');
    }

    private function present(Role $role): array
    {
        $role->load('permissions')->loadCount(['users' => fn ($users) => $users->whereNull('archived_at')]);
        $data = $role->toArray();
        $data['key'] = $role->key_name;
        $data['permissions'] = $role->is_system && $role->key_name === 'admin'
            ? PermissionCatalog::keys()
            : PermissionCatalog::effective($role->permissions->pluck('permission_key')->values()->all());
        $data['affected_users_count'] = User::withTrashed()->where('role_id', $role->id)->count();

        return $data;
    }
}
