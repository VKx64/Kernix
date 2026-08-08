<?php

namespace Database\Seeders;

use App\Support\DefaultRoles;
use App\Support\PermissionCatalog;
use App\Support\TaskSignals;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use LogicException;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $adminPassword = null;
        if (! DB::table('users')->where('id', 1)->exists()) {
            $adminPassword = config('auth.initial_admin_password');
            if (! is_string($adminPassword) || strlen($adminPassword) < 12) {
                throw new LogicException('Set ADMIN_PASSWORD to at least 12 characters before the initial database seed.');
            }
        }

        $now = now();
        DB::table('roles')->insertOrIgnore(['id' => 1, 'name' => 'Administrator', 'key_name' => 'admin', 'is_system' => true, 'sort_order' => 1, 'created_at' => $now, 'updated_at' => $now]);

        $permissions = PermissionCatalog::keys();
        DB::table('role_permissions')->where('role_id', 1)->whereNotIn('permission_key', $permissions)->delete();
        DB::table('role_permissions')->insertOrIgnore(array_map(fn ($key) => ['role_id' => 1, 'permission_key' => $key], $permissions));

        foreach (DefaultRoles::definitions() as $definition) {
            $this->createDefaultRoleOnce($definition, $now);
        }

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

        if ($adminPassword !== null) {
            DB::table('users')->insertOrIgnore([
                'id' => 1,
                'role_id' => 1, 'username' => env('ADMIN_USERNAME', 'admin'), 'password_hash' => Hash::make($adminPassword),
                'first_name' => 'Admin', 'last_name' => 'User', 'department_value_id' => 21, 'status' => 'active', 'timezone' => 'Asia/Manila',
                'theme_preset' => 'imagic_purple', 'created_at' => $now, 'updated_at' => $now,
            ]);
        }
        $this->ensureDefaultWorkspace($now);
        DB::table('system_settings')->insertOrIgnore(['id' => 1, 'default_timezone' => 'Asia/Manila', 'smtp_port' => 587, 'smtp_encryption' => 'tls', 'smtp_from_name' => config('app.name', 'Kernix'), 'storage_driver' => 'local', 'local_upload_path' => 'uploads', 'single_client_mode' => false, 'created_at' => $now, 'updated_at' => $now]);
    }

    /**
     * Nobody should sign in without a workspace, including accounts inserted by
     * this seeder rather than through the model.
     */
    private function ensureDefaultWorkspace(mixed $now): void
    {
        $workspaceId = DB::table('workspaces')->orderBy('id')->value('id');
        if (! $workspaceId) {
            $workspaceId = DB::table('workspaces')->insertGetId([
                'name' => config('app.name', 'Workspace'),
                'slug' => 'default',
                'created_by' => DB::table('users')->min('id'),
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        $unassigned = DB::table('users')
            ->whereNotExists(fn ($query) => $query->select(DB::raw(1))->from('workspace_user')->whereColumn('workspace_user.user_id', 'users.id'))
            ->pluck('id')
            ->map(fn ($userId) => ['workspace_id' => $workspaceId, 'user_id' => $userId, 'created_at' => $now, 'updated_at' => $now])
            ->all();
        if ($unassigned !== []) {
            DB::table('workspace_user')->insertOrIgnore($unassigned);
        }
        DB::table('users')->whereNull('active_workspace_id')->update(['active_workspace_id' => $workspaceId]);
    }

    /** @param array{name: string, key_name: string, sort_order: int, permissions: array<int, string>} $definition */
    private function createDefaultRoleOnce(array $definition, mixed $now): void
    {
        DB::transaction(function () use ($definition, $now): void {
            // Include soft-deleted rows so deleting a starter role remains an
            // intentional administrator choice after future container starts.
            if (DB::table('roles')->where(function ($query) use ($definition): void {
                $query->where('key_name', $definition['key_name'])
                    ->orWhere('name', $definition['name']);
            })->exists()) {
                return;
            }

            $permissions = array_values(array_unique($definition['permissions']));
            $invalid = array_values(array_diff($permissions, PermissionCatalog::keys()));
            $missing = PermissionCatalog::missingDependencies($permissions);
            if (! in_array('dashboard.view', $permissions, true) || $invalid !== [] || $missing !== []) {
                throw new LogicException('Invalid default permission preset for '.$definition['name'].'.');
            }

            $roleId = DB::table('roles')->insertGetId([
                'name' => $definition['name'],
                'key_name' => $definition['key_name'],
                'is_system' => false,
                'sort_order' => $definition['sort_order'],
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            DB::table('role_permissions')->insert(array_map(
                fn (string $key): array => ['role_id' => $roleId, 'permission_key' => $key],
                $permissions
            ));
        });
    }
}
