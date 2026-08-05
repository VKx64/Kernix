<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('task_work_requests')) {
            Schema::create('task_work_requests', function (Blueprint $table) {
                $table->increments('id');
                $table->unsignedInteger('task_id');
                $table->unsignedInteger('requester_user_id');
                $table->text('reason');
                // pending: awaiting a reviewer. approved: the requester was assigned.
                // declined: refused. withdrawn: the requester pulled it back.
                $table->string('status', 16)->default('pending');
                $table->unsignedInteger('decided_by')->nullable();
                $table->text('decision_reason')->nullable();
                $table->timestamp('decided_at')->nullable();
                $table->timestamps();
                $table->softDeletes();
                $table->foreign('task_id')->references('id')->on('tasks')->cascadeOnDelete();
                $table->foreign('requester_user_id')->references('id')->on('users')->cascadeOnDelete();
                $table->foreign('decided_by')->references('id')->on('users')->nullOnDelete();
                // Reviewers list by status; a requester reads back their own.
                $table->index(['task_id', 'status']);
                $table->index(['requester_user_id', 'status']);
            });
        }

        // Work becomes assignee-only, so every role that legitimately acts on
        // someone else's task has to keep that reach explicitly. These four
        // permissions are exactly the ones whose holders reach a guarded path on
        // a task they will never be the assignee of: reviewers settling proof or
        // estimates, managers reassigning, and archivers tidying up.
        $oversight = DB::table('role_permissions')
            ->whereIn('permission_key', [
                'tasks.assign',
                'tasks.review_estimate_requests',
                'tasks.review_completion',
                'tasks.archive',
            ])
            ->distinct()
            ->pluck('role_id');

        $grants = [];
        foreach ($oversight as $roleId) {
            $grants[] = ['role_id' => $roleId, 'permission_key' => 'tasks.work_unassigned'];
        }

        // Deciding who works on what already belongs to whoever can assign.
        $assigners = DB::table('role_permissions')
            ->where('permission_key', 'tasks.assign')
            ->distinct()
            ->pluck('role_id');
        foreach ($assigners as $roleId) {
            $grants[] = ['role_id' => $roleId, 'permission_key' => 'tasks.review_work_requests'];
        }

        // Anyone who can comment on a task can ask to be put on one. The
        // dependency chain must be granted too: PermissionCatalog::effective()
        // silently drops a key whose requirements are incomplete, so granting
        // tasks.request_work alone would look applied and do nothing.
        $requesters = DB::table('role_permissions')
            ->where('permission_key', 'tasks.comment')
            ->distinct()
            ->pluck('role_id');
        foreach ($requesters as $roleId) {
            foreach (['tasks.view', 'messages.view', 'tasks.request_work'] as $key) {
                $grants[] = ['role_id' => $roleId, 'permission_key' => $key];
            }
        }

        if ($grants !== []) {
            DB::table('role_permissions')->insertOrIgnore($grants);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('task_work_requests');
        // Removes these keys from every role, including any an administrator
        // granted by hand after the upgrade. That is the intended rollback:
        // the permissions stop existing, so no role should still reference them.
        DB::table('role_permissions')->whereIn('permission_key', [
            'tasks.work_unassigned',
            'tasks.request_work',
            'tasks.review_work_requests',
        ])->delete();
    }
};
