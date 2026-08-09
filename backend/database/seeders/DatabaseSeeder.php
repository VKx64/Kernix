<?php

namespace Database\Seeders;

use App\Models\Workspace;
use App\Support\WorkspaceProvisioner;
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
        // A workspace, its roles, and the shared field catalogue all come from
        // the provisioner, so a seeded workspace looks exactly like one created
        // through onboarding.
        $workspace = Workspace::query()->orderBy('id')->first() ?? Workspace::query()->create([
            'name' => config('app.name', 'Workspace'),
            'slug' => 'default',
            'created_by' => DB::table('users')->min('id'),
        ]);
        WorkspaceProvisioner::seed($workspace);
        $adminRoleId = WorkspaceProvisioner::adminRole($workspace)->getKey();

        if ($adminPassword !== null) {
            DB::table('users')->insertOrIgnore([
                'id' => 1,
                'role_id' => $adminRoleId, 'username' => env('ADMIN_USERNAME', 'admin'), 'password_hash' => Hash::make($adminPassword),
                'first_name' => 'Admin', 'last_name' => 'User', 'department_value_id' => 21, 'status' => 'active', 'timezone' => 'Asia/Manila',
                'theme_preset' => 'imagic_purple', 'created_at' => $now, 'updated_at' => $now,
            ]);
        }
        $this->ensureDefaultWorkspace($workspace, $now);
        DB::table('system_settings')->insertOrIgnore(['id' => 1, 'default_timezone' => 'Asia/Manila', 'smtp_port' => 587, 'smtp_encryption' => 'tls', 'smtp_from_name' => config('app.name', 'Kernix'), 'storage_driver' => 'local', 'local_upload_path' => 'uploads', 'single_client_mode' => false, 'created_at' => $now, 'updated_at' => $now]);
    }

    /**
     * Nobody should sign in without a workspace, including accounts inserted by
     * this seeder rather than through the model. Each membership carries the
     * role the account already had.
     */
    private function ensureDefaultWorkspace(Workspace $workspace, mixed $now): void
    {
        $workspaceId = $workspace->getKey();
        if (! $workspace->created_by) {
            $workspace->forceFill(['created_by' => DB::table('users')->min('id')])->saveQuietly();
        }

        // An account with no role at all is waiting to onboard and is left
        // alone; pulling it in here would drop a stranger into this workspace.
        $unassigned = DB::table('users')
            ->whereNotNull('role_id')
            ->whereNotExists(fn ($query) => $query->select(DB::raw(1))->from('workspace_user')->whereColumn('workspace_user.user_id', 'users.id'))
            ->get(['id', 'role_id'])
            ->map(fn ($user) => ['workspace_id' => $workspaceId, 'user_id' => $user->id, 'role_id' => $user->role_id, 'created_at' => $now, 'updated_at' => $now])
            ->all();
        if ($unassigned !== []) {
            DB::table('workspace_user')->insertOrIgnore($unassigned);
        }
        DB::table('users')
            ->whereNull('active_workspace_id')
            ->whereExists(fn ($query) => $query->select(DB::raw(1))->from('workspace_user')
                ->whereColumn('workspace_user.user_id', 'users.id')
                ->where('workspace_user.workspace_id', $workspaceId))
            ->update(['active_workspace_id' => $workspaceId]);
    }
}
