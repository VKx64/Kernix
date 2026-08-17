<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Employees could not write down a job for themselves at all — no
     * `tasks.create` — so anything they noticed had to be relayed to somebody
     * with the permission, and often was not.
     *
     * They can now, and nothing is granted by it: a creator who cannot assign
     * gets a task that lands on the project manager with a work request
     * attached, and stays unable to touch it until that request is approved.
     * The gate is the same one already used for picking up any task that is
     * not yours.
     *
     * Targeted at roles holding `tasks.request_work`, which is what marks a
     * role as working under review rather than deciding. A manager role holds
     * `tasks.review_work_requests` instead and already had `tasks.create`.
     *
     * Additive only. No permission is removed and no other row is touched, so
     * a role somebody has already customised keeps everything it had.
     */
    public function up(): void
    {
        $roleIds = DB::table('role_permissions')
            ->where('permission_key', 'tasks.request_work')
            ->distinct()
            ->pluck('role_id');

        $grants = $roleIds
            ->map(fn ($roleId) => ['role_id' => $roleId, 'permission_key' => 'tasks.create'])
            ->all();

        if ($grants !== []) {
            DB::table('role_permissions')->insertOrIgnore($grants);
        }
    }

    public function down(): void
    {
        // Only where this migration could have added it, and never from a role
        // that also reviews requests — such a role could create tasks long
        // before this ran, and reversing a migration must not take away a
        // permission it did not give.
        $reviewers = DB::table('role_permissions')
            ->where('permission_key', 'tasks.review_work_requests')
            ->distinct()
            ->pluck('role_id');

        $roleIds = DB::table('role_permissions')
            ->where('permission_key', 'tasks.request_work')
            ->whereNotIn('role_id', $reviewers)
            ->distinct()
            ->pluck('role_id');

        DB::table('role_permissions')
            ->whereIn('role_id', $roleIds)
            ->where('permission_key', 'tasks.create')
            ->delete();
    }
};
