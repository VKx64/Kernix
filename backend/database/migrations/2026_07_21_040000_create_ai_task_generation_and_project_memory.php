<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        foreach (['ai_task_creation_enabled', 'ai_memory_enabled'] as $column) {
            if (! Schema::hasColumn('projects', $column)) {
                Schema::table('projects', fn (Blueprint $table) => $table->boolean($column)->default(false));
            }
        }

        if (! Schema::hasTable('project_ai_profiles')) {
            Schema::create('project_ai_profiles', function (Blueprint $table) {
                $table->increments('id');
                $table->unsignedInteger('project_id')->unique();
                $table->longText('draft_brief')->nullable();
                $table->longText('approved_brief')->nullable();
                $table->string('brief_status', 16)->default('empty');
                $table->unsignedInteger('version')->default(0);
                $table->unsignedInteger('approved_by')->nullable();
                $table->dateTime('approved_at')->nullable();
                $table->timestamps();
                $table->foreign('project_id')->references('id')->on('projects')->cascadeOnDelete();
                $table->foreign('approved_by')->references('id')->on('users')->nullOnDelete();
            });
        }

        if (! Schema::hasTable('ai_task_generations')) {
            Schema::create('ai_task_generations', function (Blueprint $table) {
                $table->increments('id');
                $table->unsignedInteger('project_id');
                $table->unsignedInteger('task_folder_id')->nullable();
                $table->unsignedInteger('requested_by');
                $table->string('status', 24)->default('queued');
                $table->text('initial_prompt');
                $table->unsignedTinyInteger('clarification_rounds')->default(0);
                $table->text('result_summary')->nullable();
                $table->dateTime('undo_expires_at')->nullable();
                $table->string('error_code', 64)->nullable();
                $table->text('error_message')->nullable();
                $table->timestamps();
                $table->foreign('project_id')->references('id')->on('projects')->cascadeOnDelete();
                $table->foreign('task_folder_id')->references('id')->on('task_folders')->nullOnDelete();
                $table->foreign('requested_by')->references('id')->on('users')->restrictOnDelete();
                $table->index(['project_id', 'status'], 'ai_task_gen_project_status_idx');
            });
        }

        if (! Schema::hasColumn('tasks', 'ai_task_generation_id')) {
            Schema::table('tasks', function (Blueprint $table) {
                $table->unsignedInteger('ai_task_generation_id')->nullable();
                $table->foreign('ai_task_generation_id')->references('id')->on('ai_task_generations')->nullOnDelete();
            });
        }

        if (! Schema::hasTable('ai_task_generation_messages')) {
            Schema::create('ai_task_generation_messages', function (Blueprint $table) {
                $table->increments('id');
                $table->unsignedInteger('generation_id');
                $table->string('role', 16);
                $table->longText('body');
                $table->unsignedInteger('created_by')->nullable();
                $table->timestamps();
                $table->foreign('generation_id')->references('id')->on('ai_task_generations')->cascadeOnDelete();
                $table->foreign('created_by')->references('id')->on('users')->nullOnDelete();
                $table->index(['generation_id', 'created_at'], 'ai_task_gen_messages_idx');
            });
        }

        if (! Schema::hasTable('ai_task_generation_tasks')) {
            Schema::create('ai_task_generation_tasks', function (Blueprint $table) {
                $table->increments('id');
                $table->unsignedInteger('generation_id');
                $table->unsignedInteger('task_id')->unique();
                $table->string('baseline_hash', 64);
                $table->timestamps();
                $table->foreign('generation_id')->references('id')->on('ai_task_generations')->cascadeOnDelete();
                $table->foreign('task_id')->references('id')->on('tasks')->cascadeOnDelete();
            });
        }

        if (! Schema::hasTable('project_memory_entries')) {
            Schema::create('project_memory_entries', function (Blueprint $table) {
                $table->increments('id');
                $table->unsignedInteger('project_id');
                $table->unsignedInteger('source_task_id')->nullable();
                $table->string('category', 32);
                $table->text('content');
                $table->text('evidence')->nullable();
                $table->string('status', 24)->default('pending');
                $table->unsignedTinyInteger('importance')->default(3);
                $table->string('proposed_by_type', 16)->default('ai');
                $table->unsignedInteger('proposed_by_user_id')->nullable();
                $table->string('completion_hash', 64)->nullable();
                $table->string('content_hash', 64);
                $table->unsignedInteger('reviewed_by')->nullable();
                $table->dateTime('reviewed_at')->nullable();
                $table->text('rejection_reason')->nullable();
                $table->timestamps();
                $table->foreign('project_id')->references('id')->on('projects')->cascadeOnDelete();
                $table->foreign('source_task_id')->references('id')->on('tasks')->nullOnDelete();
                $table->foreign('proposed_by_user_id')->references('id')->on('users')->nullOnDelete();
                $table->foreign('reviewed_by')->references('id')->on('users')->nullOnDelete();
                $table->index(['project_id', 'status'], 'project_memory_status_idx');
                $table->index(['source_task_id', 'completion_hash'], 'project_memory_source_hash_idx');
            });
        }

        if (! Schema::hasTable('project_memory_learning_runs')) {
            Schema::create('project_memory_learning_runs', function (Blueprint $table) {
                $table->increments('id');
                $table->unsignedInteger('project_id');
                $table->unsignedInteger('task_id');
                $table->string('completion_hash', 64);
                $table->string('status', 24)->default('queued');
                $table->string('error_code', 64)->nullable();
                $table->text('error_message')->nullable();
                $table->timestamps();
                $table->foreign('project_id')->references('id')->on('projects')->cascadeOnDelete();
                $table->foreign('task_id')->references('id')->on('tasks')->cascadeOnDelete();
                $table->unique(['task_id', 'completion_hash'], 'project_memory_run_unique');
            });
        }

        if (! Schema::hasTable('ai_usage_events')) {
            Schema::create('ai_usage_events', function (Blueprint $table) {
                $table->increments('id');
                $table->string('feature', 32);
                $table->unsignedInteger('project_id')->nullable();
                $table->unsignedInteger('user_id')->nullable();
                $table->string('source_type', 64);
                $table->unsignedInteger('source_id')->nullable();
                $table->string('external_generation_id', 191)->nullable();
                $table->string('model', 191)->nullable();
                $table->unsignedInteger('prompt_tokens')->nullable();
                $table->unsignedInteger('completion_tokens')->nullable();
                $table->unsignedInteger('total_tokens')->nullable();
                $table->decimal('cost_usd', 14, 8)->default(0);
                $table->string('status', 24)->default('succeeded');
                $table->timestamps();
                $table->foreign('project_id')->references('id')->on('projects')->nullOnDelete();
                $table->foreign('user_id')->references('id')->on('users')->nullOnDelete();
                $table->unique(['source_type', 'source_id'], 'ai_usage_source_unique');
                $table->index(['created_at', 'feature'], 'ai_usage_month_feature_idx');
            });

            DB::table('ai_review_runs')->orderBy('id')->each(function ($run): void {
                DB::table('ai_usage_events')->insertOrIgnore([
                    'feature' => 'estimate_review',
                    'project_id' => DB::table('task_estimate_requests')->join('tasks', 'tasks.id', '=', 'task_estimate_requests.task_id')->where('task_estimate_requests.id', $run->task_estimate_request_id)->value('tasks.project_id'),
                    'user_id' => null,
                    'source_type' => 'ai_review_run',
                    'source_id' => $run->id,
                    'external_generation_id' => $run->external_generation_id,
                    'model' => $run->actual_model ?: $run->requested_model,
                    'prompt_tokens' => $run->prompt_tokens,
                    'completion_tokens' => $run->completion_tokens,
                    'total_tokens' => $run->total_tokens,
                    'cost_usd' => $run->cost_usd,
                    'status' => $run->status,
                    'created_at' => $run->created_at,
                    'updated_at' => $run->updated_at,
                ]);
            });
        }

        $managerRole = DB::table('roles')->where('key_name', 'project_management_role')->value('id');
        if ($managerRole) {
            DB::table('role_permissions')->insertOrIgnore([
                ['role_id' => $managerRole, 'permission_key' => 'tasks.create_with_ai'],
                ['role_id' => $managerRole, 'permission_key' => 'projects.manage_ai_memory'],
            ]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_usage_events');
        Schema::dropIfExists('project_memory_learning_runs');
        Schema::dropIfExists('project_memory_entries');
        Schema::dropIfExists('ai_task_generation_tasks');
        Schema::dropIfExists('ai_task_generation_messages');
        if (Schema::hasColumn('tasks', 'ai_task_generation_id')) {
            Schema::table('tasks', function (Blueprint $table) {
                $table->dropForeign(['ai_task_generation_id']);
                $table->dropColumn('ai_task_generation_id');
            });
        }
        Schema::dropIfExists('ai_task_generations');
        Schema::dropIfExists('project_ai_profiles');
        Schema::table('projects', fn (Blueprint $table) => $table->dropColumn(['ai_task_creation_enabled', 'ai_memory_enabled']));
    }
};
