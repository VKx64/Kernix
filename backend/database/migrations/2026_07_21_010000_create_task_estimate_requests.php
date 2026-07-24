<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('task_estimate_requests', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('task_id');
            $table->unsignedInteger('requested_by');
            $table->unsignedInteger('reviewer_user_id')->nullable();
            $table->unsignedInteger('base_estimated_minutes')->default(0);
            $table->unsignedInteger('requested_additional_minutes');
            $table->unsignedInteger('approved_additional_minutes')->nullable();
            $table->string('status', 24)->default('pending');
            $table->text('request_reason');
            $table->text('decision_reason')->nullable();
            $table->unsignedInteger('decided_by')->nullable();
            $table->dateTime('decided_at')->nullable();
            $table->unsignedInteger('replaced_by_id')->nullable();
            $table->timestamps();

            $table->foreign('task_id')->references('id')->on('tasks')->cascadeOnDelete();
            $table->foreign('requested_by')->references('id')->on('users');
            $table->foreign('reviewer_user_id')->references('id')->on('users')->nullOnDelete();
            $table->foreign('decided_by')->references('id')->on('users')->nullOnDelete();
            $table->foreign('replaced_by_id')->references('id')->on('task_estimate_requests')->nullOnDelete();
            $table->index(['task_id', 'status']);
        });

        Schema::table('task_notes', function (Blueprint $table) {
            $table->unsignedInteger('conversation_id')->nullable()->after('is_message');
            $table->unsignedInteger('estimate_request_id')->nullable()->after('conversation_id');
            $table->foreign('conversation_id')->references('id')->on('task_notes')->nullOnDelete();
            $table->foreign('estimate_request_id')->references('id')->on('task_estimate_requests')->cascadeOnDelete();
            $table->index(['conversation_id', 'created_at']);
        });

        DB::table('task_notes')->where('is_message', true)->orderBy('id')->eachById(function ($note): void {
            DB::table('task_notes')->where('id', $note->id)->update(['conversation_id' => $note->id]);
        });

        $roleIds = DB::table('roles')->whereIn('key_name', ['employee_role', 'project_management_role'])
            ->pluck('id', 'key_name');
        $grants = [];
        if ($roleIds->has('employee_role')) {
            foreach (['dashboard.view', 'messages.view', 'time.track', 'tasks.view', 'tasks.comment', 'tasks.request_estimate'] as $permission) {
                $grants[] = ['role_id' => $roleIds['employee_role'], 'permission_key' => $permission];
            }
        }
        if ($roleIds->has('project_management_role')) {
            foreach (['dashboard.view', 'messages.view', 'time.track', 'tasks.view', 'tasks.comment', 'tasks.estimate', 'tasks.review_estimate_requests'] as $permission) {
                $grants[] = ['role_id' => $roleIds['project_management_role'], 'permission_key' => $permission];
            }
        }
        if ($grants !== []) {
            DB::table('role_permissions')->insertOrIgnore($grants);
        }
    }

    public function down(): void
    {
        DB::table('role_permissions')->whereIn('permission_key', [
            'tasks.request_estimate', 'tasks.review_estimate_requests',
        ])->delete();

        Schema::table('task_notes', function (Blueprint $table) {
            $table->dropForeign(['conversation_id']);
            $table->dropForeign(['estimate_request_id']);
            $table->dropIndex(['conversation_id', 'created_at']);
            $table->dropColumn(['conversation_id', 'estimate_request_id']);
        });
        Schema::dropIfExists('task_estimate_requests');
    }
};
