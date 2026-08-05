<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('task_completion_proofs')) {
            Schema::create('task_completion_proofs', function (Blueprint $table) {
                $table->increments('id');
                $table->unsignedInteger('task_id');
                $table->unsignedInteger('submitted_by')->nullable();
                $table->text('summary');
                // pending: waiting on the audit. approved/rejected: settled.
                $table->string('status', 24)->default('pending');
                $table->string('ai_state', 24)->default('queued');
                $table->string('ai_verdict', 24)->nullable();
                $table->text('ai_message')->nullable();
                $table->json('ai_missing_evidence')->nullable();
                $table->string('error_code', 64)->nullable();
                $table->text('error_message')->nullable();
                $table->unsignedInteger('reviewed_by')->nullable();
                $table->string('review_mode', 16)->nullable();
                $table->text('review_reason')->nullable();
                $table->timestamp('reviewed_at')->nullable();
                $table->unsignedInteger('previous_status_value_id')->nullable();
                $table->timestamps();
                $table->foreign('task_id')->references('id')->on('tasks')->cascadeOnDelete();
                $table->foreign('submitted_by')->references('id')->on('users')->nullOnDelete();
                $table->foreign('reviewed_by')->references('id')->on('users')->nullOnDelete();
                $table->index(['task_id', 'status']);
            });
        }

        if (Schema::hasTable('task_attachments') && ! Schema::hasColumn('task_attachments', 'completion_proof_id')) {
            Schema::table('task_attachments', function (Blueprint $table) {
                $table->unsignedInteger('completion_proof_id')->nullable()->after('task_id');
                $table->foreign('completion_proof_id')->references('id')->on('task_completion_proofs')->nullOnDelete();
            });
        }

        // Submitting proof is part of finishing work; reviewing it is not.
        $roleIds = DB::table('role_permissions')
            ->whereIn('permission_key', ['tasks.review_estimate_requests', 'projects.edit'])
            ->distinct()
            ->pluck('role_id');
        $grants = $roleIds
            ->map(fn ($roleId) => ['role_id' => $roleId, 'permission_key' => 'tasks.review_completion'])
            ->all();
        if ($grants !== []) {
            DB::table('role_permissions')->insertOrIgnore($grants);
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('task_attachments') && Schema::hasColumn('task_attachments', 'completion_proof_id')) {
            Schema::table('task_attachments', function (Blueprint $table) {
                $table->dropForeign(['completion_proof_id']);
                $table->dropColumn('completion_proof_id');
            });
        }
        Schema::dropIfExists('task_completion_proofs');
        DB::table('role_permissions')->where('permission_key', 'tasks.review_completion')->delete();
    }
};
