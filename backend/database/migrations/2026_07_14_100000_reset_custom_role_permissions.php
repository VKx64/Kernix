<?php

use App\Models\User;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        $customRoles = DB::table('roles')
            ->where('is_system', false)
            ->whereNull('deleted_at')
            ->get(['id', 'name']);

        foreach ($customRoles as $role) {
            $before = DB::table('role_permissions')
                ->where('role_id', $role->id)
                ->orderBy('permission_key')
                ->pluck('permission_key')
                ->all();

            // Makes the data migration safe to re-run without repeatedly
            // rotating credentials for roles that are already migrated.
            if ($before === ['dashboard.view']) {
                continue;
            }

            DB::transaction(function () use ($role, $before): void {
                DB::table('role_permissions')->where('role_id', $role->id)->delete();
                DB::table('role_permissions')->insert([
                    'role_id' => $role->id,
                    'permission_key' => 'dashboard.view',
                ]);

                $userIds = DB::table('users')->where('role_id', $role->id)->pluck('id');
                if ($userIds->isNotEmpty()) {
                    DB::table('sessions')->whereIn('user_id', $userIds)->delete();
                    DB::table('personal_access_tokens')
                        ->where('tokenable_type', (new User)->getMorphClass())
                        ->whereIn('tokenable_id', $userIds)
                        ->delete();
                    foreach ($userIds as $userId) {
                        DB::table('users')->where('id', $userId)->update([
                            'remember_token' => Str::random(60),
                        ]);
                    }
                }

                DB::table('audit_logs')->insert([
                    'user_id' => null,
                    'action' => 'role.permissions_reset',
                    'entity_type' => 'Role',
                    'entity_id' => $role->id,
                    'summary' => 'Reset custom role permissions during RBAC migration',
                    'changes_json' => json_encode([
                        'before' => $before,
                        'after' => ['dashboard.view'],
                        'affected_users' => $userIds->count(),
                        'sessions_revoked' => true,
                    ], JSON_THROW_ON_ERROR),
                    'ip_address' => null,
                    'user_agent' => null,
                    'created_at' => now(),
                ]);
            });
        }
    }

    public function down(): void
    {
        // The previous permission assignments cannot be reconstructed safely.
    }
};
