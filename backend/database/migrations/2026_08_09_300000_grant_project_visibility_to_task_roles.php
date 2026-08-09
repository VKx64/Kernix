<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Projects became a screen an employee works from rather than an admin
     * register, so any role that already works on tasks can see the projects
     * those tasks belong to. Viewing is read-only; creating, editing and
     * archiving keep their own permissions.
     *
     * Client visibility is deliberately not granted here — account health and
     * retainer burn stay with the roles that already hold `clients.view`.
     */
    public function up(): void
    {
        $roleIds = DB::table('role_permissions')
            ->where('permission_key', 'tasks.view')
            ->distinct()
            ->pluck('role_id');

        $grants = $roleIds
            ->map(fn ($roleId) => ['role_id' => $roleId, 'permission_key' => 'projects.view'])
            ->all();

        if ($grants !== []) {
            DB::table('role_permissions')->insertOrIgnore($grants);
        }
    }

    public function down(): void
    {
        // Only the roles this migration could have added it to; a role that
        // held `projects.view` without `tasks.view` was never touched.
        $roleIds = DB::table('role_permissions')
            ->where('permission_key', 'tasks.view')
            ->distinct()
            ->pluck('role_id');

        DB::table('role_permissions')
            ->whereIn('role_id', $roleIds)
            ->where('permission_key', 'projects.view')
            ->delete();
    }
};
