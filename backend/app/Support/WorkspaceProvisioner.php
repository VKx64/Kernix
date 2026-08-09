<?php

namespace App\Support;

use App\Models\Client;
use App\Models\Project;
use App\Models\Role;
use App\Models\User;
use App\Models\Workspace;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use LogicException;

/**
 * The one place a workspace comes into existence. Creating a workspace anywhere
 * else would leave it without roles, so both the seeders and the onboarding
 * endpoint come through here.
 *
 * Everything is idempotent per workspace: running it twice adds nothing.
 */
final class WorkspaceProvisioner
{
    public const ADMIN_ROLE_KEY = 'admin';

    /** Create a workspace, give it its own roles, and make the owner its administrator. */
    public static function provision(User $owner, string $name): Workspace
    {
        return DB::transaction(function () use ($owner, $name): Workspace {
            $workspace = Workspace::query()->create([
                'name' => trim($name),
                'slug' => self::uniqueSlug($name),
                'created_by' => $owner->getKey(),
            ]);
            self::seed($workspace);
            self::join($workspace, $owner, self::adminRole($workspace));

            return $workspace->refresh();
        });
    }

    /** Give an existing workspace the roles and shared field catalogue it needs. */
    public static function seed(Workspace $workspace): Workspace
    {
        self::seedFieldCatalog();
        self::seedRoles($workspace);

        return $workspace;
    }

    /**
     * Add somebody to a workspace with the role they hold there. The legacy
     * `users.role_id` column is kept in step so the fallback path and anything
     * still reading that column agree with the membership.
     */
    public static function join(Workspace $workspace, User $user, ?Role $role = null, bool $activate = true): void
    {
        $user->workspaces()->syncWithoutDetaching([
            $workspace->getKey() => ['role_id' => $role?->getKey()],
        ]);

        $attributes = [];
        if ($role && ! $user->role_id) {
            $attributes['role_id'] = $role->getKey();
        }
        if ($activate) {
            $attributes['active_workspace_id'] = $workspace->getKey();
        }
        if ($attributes !== []) {
            $user->forceFill($attributes)->saveQuietly();
        }
        $user->forgetWorkspaceRole();
    }

    public static function adminRole(Workspace $workspace): Role
    {
        $role = Role::acrossWorkspaces()
            ->where('workspace_id', $workspace->getKey())
            ->where('key_name', self::ADMIN_ROLE_KEY)
            ->first();
        if (! $role) {
            throw new LogicException('Workspace '.$workspace->getKey().' has no administrator role; seed it first.');
        }

        return $role;
    }

    /**
     * The administrator role plus the starter presets, one copy per workspace.
     * Presets are created once and later edits or deletions are left alone, the
     * same way the seeder has always treated them.
     */
    private static function seedRoles(Workspace $workspace): void
    {
        $workspaceId = (int) $workspace->getKey();
        $now = now();

        $adminRoleId = Role::acrossWorkspaces()->withTrashed()
            ->where('workspace_id', $workspaceId)
            ->where('key_name', self::ADMIN_ROLE_KEY)
            ->value('id');
        if (! $adminRoleId) {
            $adminRoleId = DB::table('roles')->insertGetId([
                'workspace_id' => $workspaceId,
                'name' => 'Administrator',
                'key_name' => self::ADMIN_ROLE_KEY,
                'is_system' => true,
                'sort_order' => 1,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        // The administrator holds the whole catalogue, so anything retired from
        // it is removed rather than left behind as a stale grant.
        $permissions = PermissionCatalog::keys();
        DB::table('role_permissions')->where('role_id', $adminRoleId)->whereNotIn('permission_key', $permissions)->delete();
        DB::table('role_permissions')->insertOrIgnore(array_map(
            fn (string $key): array => ['role_id' => $adminRoleId, 'permission_key' => $key, 'workspace_id' => $workspaceId],
            $permissions
        ));
        DB::table('role_permissions')->where('role_id', $adminRoleId)->whereNull('workspace_id')->update(['workspace_id' => $workspaceId]);

        foreach (DefaultRoles::definitions() as $definition) {
            self::seedPresetRole($workspaceId, $definition, $now);
        }
    }

    /** @param array{name: string, key_name: string, sort_order: int, permissions: array<int, string>} $definition */
    private static function seedPresetRole(int $workspaceId, array $definition, mixed $now): void
    {
        DB::transaction(function () use ($workspaceId, $definition, $now): void {
            // Soft-deleted rows count, so removing a starter role stays an
            // intentional administrator choice across later restarts.
            $exists = Role::acrossWorkspaces()->withTrashed()
                ->where('workspace_id', $workspaceId)
                ->where(fn ($query) => $query
                    ->where('key_name', $definition['key_name'])
                    ->orWhere('name', $definition['name']))
                ->exists();
            if ($exists) {
                return;
            }

            $permissions = array_values(array_unique($definition['permissions']));
            $invalid = array_values(array_diff($permissions, PermissionCatalog::keys()));
            $missing = PermissionCatalog::missingDependencies($permissions);
            if (! in_array('dashboard.view', $permissions, true) || $invalid !== [] || $missing !== []) {
                throw new LogicException('Invalid default permission preset for '.$definition['name'].'.');
            }

            $roleId = DB::table('roles')->insertGetId([
                'workspace_id' => $workspaceId,
                'name' => $definition['name'],
                'key_name' => $definition['key_name'],
                'is_system' => false,
                'sort_order' => $definition['sort_order'],
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            DB::table('role_permissions')->insert(array_map(
                fn (string $key): array => ['role_id' => $roleId, 'permission_key' => $key, 'workspace_id' => $workspaceId],
                $permissions
            ));
        });
    }

    /**
     * The six field groups every workspace works with. Fields and field values
     * are not workspace columns yet, so this catalogue is still shared; the call
     * is idempotent and a second workspace reuses the existing rows.
     */
    public static function seedFieldCatalog(): void
    {
        $now = now();
        $fields = [
            [1, 'Client Status', 'client_status', 'Lifecycle status for clients'], [2, 'Project Status', 'project_status', 'Lifecycle status for projects'],
            [3, 'Task Status', 'task_status', 'Workflow status for tasks and subtasks'], [4, 'Task Urgency', 'task_urgency', 'Priority ordering for tasks'],
            [5, 'Task Type', 'task_type', 'Category of work'], [6, 'User Department', 'user_department', 'Team or department for users'],
        ];
        foreach ($fields as $i => [$id, $name, $key, $description]) {
            DB::table('fields')->insertOrIgnore(['id' => $id, 'name' => $name, 'key_name' => $key, 'description' => $description, 'is_system' => true, 'sort_order' => ($i + 1) * 10, 'created_at' => $now, 'updated_at' => $now]);
        }

        $groups = [
            1 => [['Active', 'active', '#22c55e'], ['Prospect', 'prospect', '#3b82f6'], ['On Hold', 'on_hold', '#f59e0b'], ['Inactive', 'inactive', '#64748b']],
            2 => [['Planning', 'planning', '#8b5cf6'], ['Active', 'active', '#22c55e'], ['On Hold', 'on_hold', '#f59e0b'], ['Complete', 'complete', '#64748b']],
            3 => [['Pending', 'pending', '#64748b'], ['In Progress', 'in_progress', '#3b82f6'], ['Blocked', 'blocked', '#ef4444'], ['Complete', 'complete', '#22c55e']],
            4 => [['Urgent', 'urgent', '#ef4444'], ['High', 'high', '#f97316'], ['Normal', 'normal', '#3b82f6'], ['Low', 'low', '#64748b']],
            5 => [['Task', 'task', '#3b82f6'], ['Bug', 'bug', '#ef4444'], ['Feature', 'feature', '#8b5cf6'], ['Request', 'request', '#14b8a6']],
            6 => [['Management', 'management', '#8b5cf6'], ['Production', 'production', '#3b82f6'], ['Design', 'design', '#ec4899'], ['Development', 'development', '#14b8a6'], ['Operations', 'operations', '#f59e0b']],
        ];
        $id = 1;
        foreach ($groups as $fieldId => $values) {
            foreach ($values as $i => [$label, $key, $color]) {
                DB::table('field_values')->insertOrIgnore(['id' => $id++, 'field_id' => $fieldId, 'label' => $label, 'key_name' => $key, 'color' => $color, 'status' => 'active', 'sort_order' => ($i + 1) * 10, 'created_at' => $now, 'updated_at' => $now]);
            }
        }

        // Colours track the fixed dark palette by semantic role
        // (TaskSignals::STATUS_ROLES), not by slug, so a status added later
        // through the field values UI still lands on a palette colour.
        $roleColors = [
            'open' => '#7a7a85', 'active' => '#7b7ff6', 'review' => '#e8a33d',
            'blocked' => '#f2585b', 'done' => '#4cb963',
        ];
        $taskStatuses = [
            ['planning', 'Planning', 10],
            ['pending', 'Pending', 20],
            ['in_progress', 'In Progress', 30],
            ['quality_check', 'Quality Check', 40],
            ['needs_correction', 'Needs Correction', 50],
            ['blocked', 'Blocked', 60],
            ['complete', 'Complete', 70],
        ];
        foreach ($taskStatuses as [$key, $label, $sortOrder]) {
            $color = $roleColors[TaskSignals::statusRole($key)];
            $statusQuery = DB::table('field_values')->where('field_id', 3)->where('key_name', $key);
            $values = ['label' => $label, 'color' => $color, 'status' => 'active', 'sort_order' => $sortOrder, 'deleted_at' => null, 'updated_at' => $now];
            if ($statusQuery->exists()) {
                $statusQuery->update($values);
            } else {
                DB::table('field_values')->insert($values + ['field_id' => 3, 'key_name' => $key, 'created_at' => $now]);
            }
        }
        $taskUrgencies = [
            ['urgent', 'Urgent', '#f2585b', 10],
            ['high', 'High', '#e8a33d', 20],
            ['normal', 'Normal', '#7a7a85', 30],
            ['low', 'Low', '#3a3a42', 40],
        ];
        foreach ($taskUrgencies as [$key, $label, $color, $sortOrder]) {
            $urgencyQuery = DB::table('field_values')->where('field_id', 4)->where('key_name', $key);
            $values = ['label' => $label, 'color' => $color, 'status' => 'active', 'sort_order' => $sortOrder, 'deleted_at' => null, 'updated_at' => $now];
            if ($urgencyQuery->exists()) {
                $urgencyQuery->update($values);
            } else {
                DB::table('field_values')->insert($values + ['field_id' => 4, 'key_name' => $key, 'created_at' => $now]);
            }
        }
    }

    /**
     * The hidden client every project and contact attaches to while Clients
     * is turned off, so `client_id` never has to go nullable. Lazy and
     * idempotent: a workspace provisioned long before this existed gets one
     * the first time it needs it, with no backfill step.
     */
    public static function defaultClient(Workspace $workspace): Client
    {
        return Client::acrossWorkspaces()->firstOrCreate(
            ['workspace_id' => $workspace->getKey(), 'is_default' => true],
            ['name' => 'General'],
        );
    }

    /** Same shape one level down, for `project_id` while Projects is off. */
    public static function defaultProject(Workspace $workspace): Project
    {
        $client = self::defaultClient($workspace);

        return Project::acrossWorkspaces()->firstOrCreate(
            ['workspace_id' => $workspace->getKey(), 'is_default' => true],
            ['name' => 'General', 'client_id' => $client->getKey()],
        );
    }

    /**
     * Called right after a feature is switched back on. A default row that
     * picked up real data while its feature was off graduates to an ordinary
     * visible row instead of staying hidden; one that is still empty stays
     * hidden until it is needed again. Never merges or deletes either way.
     */
    public static function revealDefaultRowsIfUsed(Workspace $workspace, string $feature): void
    {
        match ($feature) {
            WorkspaceFeatures::CLIENTS => self::revealDefaultClientIfUsed($workspace),
            WorkspaceFeatures::PROJECTS => self::revealDefaultProjectIfUsed($workspace),
            default => null,
        };
    }

    private static function revealDefaultClientIfUsed(Workspace $workspace): void
    {
        $client = Client::acrossWorkspaces()
            ->where('workspace_id', $workspace->getKey())
            ->where('is_default', true)
            ->first();
        if (! $client) {
            return;
        }
        if ($client->projects()->exists() || $client->contacts()->exists()) {
            $client->update(['is_default' => false]);
        }
    }

    private static function revealDefaultProjectIfUsed(Workspace $workspace): void
    {
        $project = Project::acrossWorkspaces()
            ->where('workspace_id', $workspace->getKey())
            ->where('is_default', true)
            ->first();
        if (! $project) {
            return;
        }
        if ($project->tasks()->exists()) {
            $project->update(['is_default' => false]);
        }
    }

    public static function uniqueSlug(string $name): string
    {
        $base = Str::slug($name) ?: 'workspace';
        $slug = $base;
        $suffix = 2;
        while (Workspace::withTrashed()->where('slug', $slug)->exists()) {
            $slug = $base.'-'.$suffix++;
        }

        return $slug;
    }
}
