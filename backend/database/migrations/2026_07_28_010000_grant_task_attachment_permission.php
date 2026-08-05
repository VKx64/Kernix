<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Roles that can already create or edit tasks keep working the same way
     * once files are part of a task, so they inherit the new permission.
     */
    public function up(): void
    {
        $roleIds = DB::table('role_permissions')
            ->whereIn('permission_key', ['tasks.create', 'tasks.edit'])
            ->distinct()
            ->pluck('role_id');

        $grants = $roleIds
            ->map(fn ($roleId) => ['role_id' => $roleId, 'permission_key' => 'tasks.attachments'])
            ->all();

        if ($grants !== []) {
            DB::table('role_permissions')->insertOrIgnore($grants);
        }
    }

    public function down(): void
    {
        DB::table('role_permissions')->where('permission_key', 'tasks.attachments')->delete();
    }
};
