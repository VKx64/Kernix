<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $systemColumns = [
            'openrouter_api_key' => fn (Blueprint $table) => $table->text('openrouter_api_key')->nullable(),
            'openrouter_model' => fn (Blueprint $table) => $table->string('openrouter_model', 191)->nullable(),
            'ai_monthly_budget_usd' => fn (Blueprint $table) => $table->decimal('ai_monthly_budget_usd', 10, 4)->default(25),
            'ai_max_output_tokens' => fn (Blueprint $table) => $table->unsignedInteger('ai_max_output_tokens')->default(1200),
            'ai_request_timeout_seconds' => fn (Blueprint $table) => $table->unsignedSmallInteger('ai_request_timeout_seconds')->default(60),
            'ai_inactivity_hours' => fn (Blueprint $table) => $table->unsignedSmallInteger('ai_inactivity_hours')->default(48),
        ];
        foreach ($systemColumns as $column => $add) {
            if (! Schema::hasColumn('system_settings', $column)) {
                Schema::table('system_settings', $add);
            }
        }
        if (! Schema::hasColumn('projects', 'ai_estimate_review_enabled')) {
            Schema::table('projects', fn (Blueprint $table) => $table->boolean('ai_estimate_review_enabled')->default(false));
        }
        if (! Schema::hasColumn('projects', 'ai_estimate_review_rules')) {
            Schema::table('projects', fn (Blueprint $table) => $table->text('ai_estimate_review_rules')->nullable());
        }

        if (! Schema::hasTable('ai_review_runs')) {
            Schema::create('ai_review_runs', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('task_estimate_request_id');
            $table->unsignedInteger('trigger_note_id')->nullable()->unique();
            $table->string('status', 24)->default('queued');
            $table->string('requested_model', 191)->nullable();
            $table->string('actual_model', 191)->nullable();
            $table->string('external_generation_id', 191)->nullable();
            $table->string('prompt_version', 32)->default('strict-v1');
            $table->string('context_hash', 64)->nullable();
            $table->string('action', 24)->nullable();
            $table->longText('response_message')->nullable();
            $table->json('evidence_summary')->nullable();
            $table->unsignedInteger('approved_additional_minutes')->nullable();
            $table->unsignedInteger('prompt_tokens')->nullable();
            $table->unsignedInteger('completion_tokens')->nullable();
            $table->unsignedInteger('total_tokens')->nullable();
            $table->decimal('cost_usd', 14, 8)->default(0);
            $table->unsignedSmallInteger('attempt')->default(0);
            $table->string('error_code', 64)->nullable();
            $table->text('error_message')->nullable();
            $table->dateTime('started_at')->nullable();
            $table->dateTime('finished_at')->nullable();
            $table->timestamps();

            $table->foreign('task_estimate_request_id')->references('id')->on('task_estimate_requests')->cascadeOnDelete();
            $table->foreign('trigger_note_id')->references('id')->on('task_notes')->nullOnDelete();
            $table->index(['status', 'created_at']);
            });
        }

        if (! Schema::hasTable('task_estimate_decisions')) {
            Schema::create('task_estimate_decisions', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('task_estimate_request_id');
            $table->string('source', 24);
            $table->string('action', 24);
            $table->unsignedInteger('approved_additional_minutes')->nullable();
            $table->text('reason');
            $table->unsignedInteger('decided_by')->nullable();
            $table->unsignedInteger('ai_review_run_id')->nullable();
            $table->string('prior_status', 24)->nullable();
            $table->unsignedInteger('prior_effective_additional_minutes')->default(0);
            $table->timestamp('created_at')->useCurrent();

            $table->foreign('task_estimate_request_id')->references('id')->on('task_estimate_requests')->cascadeOnDelete();
            $table->foreign('decided_by')->references('id')->on('users')->nullOnDelete();
            $table->foreign('ai_review_run_id')->references('id')->on('ai_review_runs')->nullOnDelete();
                $table->index(['task_estimate_request_id', 'created_at'], 'estimate_decisions_request_created_idx');
            });
        } elseif (! Schema::hasIndex('task_estimate_decisions', 'estimate_decisions_request_created_idx')) {
            // MySQL commits CREATE TABLE before adding indexes. This branch lets a
            // deployment safely resume if the original long generated name failed.
            Schema::table('task_estimate_decisions', fn (Blueprint $table) => $table->index(
                ['task_estimate_request_id', 'created_at'],
                'estimate_decisions_request_created_idx'
            ));
        }

        if (! Schema::hasColumn('task_estimate_requests', 'review_mode')) {
            Schema::table('task_estimate_requests', fn (Blueprint $table) => $table->string('review_mode', 16)->default('human'));
        }
        if (! Schema::hasColumn('task_estimate_requests', 'ai_state')) {
            Schema::table('task_estimate_requests', fn (Blueprint $table) => $table->string('ai_state', 32)->nullable());
        }
        if (! Schema::hasColumn('task_estimate_requests', 'awaiting_employee_since')) {
            Schema::table('task_estimate_requests', fn (Blueprint $table) => $table->dateTime('awaiting_employee_since')->nullable());
        }
        if (! Schema::hasColumn('task_estimate_requests', 'effective_additional_minutes')) {
            Schema::table('task_estimate_requests', fn (Blueprint $table) => $table->unsignedInteger('effective_additional_minutes')->default(0));
        }
        if (! Schema::hasColumn('task_estimate_requests', 'decision_source')) {
            Schema::table('task_estimate_requests', fn (Blueprint $table) => $table->string('decision_source', 24)->nullable());
        }
        if (! Schema::hasColumn('task_estimate_requests', 'latest_ai_review_run_id')) {
            Schema::table('task_estimate_requests', function (Blueprint $table) {
                $table->unsignedInteger('latest_ai_review_run_id')->nullable();
                $table->foreign('latest_ai_review_run_id')->references('id')->on('ai_review_runs')->nullOnDelete();
            });
        }
        if (! Schema::hasIndex('task_estimate_requests', 'estimate_requests_review_mode_state_idx')) {
            Schema::table('task_estimate_requests', fn (Blueprint $table) => $table->index(
                ['review_mode', 'ai_state'],
                'estimate_requests_review_mode_state_idx'
            ));
        }

        if (! Schema::hasColumn('task_notes', 'actor_type')) {
            Schema::table('task_notes', fn (Blueprint $table) => $table->string('actor_type', 16)->default('user'));
        }
        if (! Schema::hasColumn('task_notes', 'ai_review_run_id')) {
            Schema::table('task_notes', function (Blueprint $table) {
                $table->unsignedInteger('ai_review_run_id')->nullable();
                $table->foreign('ai_review_run_id')->references('id')->on('ai_review_runs')->nullOnDelete();
            });
        }
    }

    public function down(): void
    {
        Schema::table('task_notes', function (Blueprint $table) {
            $table->dropForeign(['ai_review_run_id']);
            $table->dropColumn(['actor_type', 'ai_review_run_id']);
        });
        Schema::table('task_estimate_requests', function (Blueprint $table) {
            $table->dropForeign(['latest_ai_review_run_id']);
            $table->dropIndex('estimate_requests_review_mode_state_idx');
            $table->dropColumn([
                'review_mode', 'ai_state', 'awaiting_employee_since',
                'effective_additional_minutes', 'decision_source', 'latest_ai_review_run_id',
            ]);
        });
        Schema::dropIfExists('task_estimate_decisions');
        Schema::dropIfExists('ai_review_runs');
        Schema::table('projects', function (Blueprint $table) {
            $table->dropColumn(['ai_estimate_review_enabled', 'ai_estimate_review_rules']);
        });
        Schema::table('system_settings', function (Blueprint $table) {
            $table->dropColumn([
                'openrouter_api_key', 'openrouter_model', 'ai_monthly_budget_usd',
                'ai_max_output_tokens', 'ai_request_timeout_seconds', 'ai_inactivity_hours',
            ]);
        });
    }
};
