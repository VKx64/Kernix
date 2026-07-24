<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        $roles = DB::table('roles')
            ->whereIn('key_name', ['employee_role', 'project_management_role'])
            ->pluck('id', 'key_name');
        $grants = [];
        $permissions = [
            'employee_role' => [
                'dashboard.view', 'messages.view', 'time.track', 'tasks.view', 'tasks.comment', 'tasks.request_estimate',
            ],
            'project_management_role' => [
                'dashboard.view', 'messages.view', 'time.track', 'tasks.view', 'tasks.comment', 'tasks.estimate', 'tasks.review_estimate_requests',
            ],
        ];
        foreach ($permissions as $roleKey => $keys) {
            if (! $roles->has($roleKey)) {
                continue;
            }
            foreach ($keys as $key) {
                $grants[] = ['role_id' => $roles[$roleKey], 'permission_key' => $key];
            }
        }
        if ($grants !== []) {
            DB::table('role_permissions')->insertOrIgnore($grants);
        }
    }

    public function down(): void
    {
        // These rows may predate this compatibility migration. Leaving them in
        // place avoids revoking customized role access during a rollback.
    }
};
