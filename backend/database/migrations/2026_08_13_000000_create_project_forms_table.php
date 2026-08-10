<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('project_forms')) {
            Schema::create('project_forms', function (Blueprint $table) {
                $table->increments('id');
                $table->unsignedInteger('workspace_id');
                $table->unsignedInteger('project_id');
                $table->string('title', 191);
                $table->text('blurb')->nullable();
                $table->string('header_line', 191)->nullable();
                $table->string('icon', 16)->nullable();
                $table->string('slug', 64)->unique();
                $table->dateTime('slug_rotated_at')->nullable();
                $table->string('state', 16)->default('live');
                $table->json('fields');
                $table->unsignedInteger('next_field_seq')->default(1);
                $table->boolean('require_email')->default(false);
                $table->boolean('auto_convert')->default(false);
                $table->boolean('notify')->default(true);
                $table->string('task_type_key', 32)->nullable();
                $table->date('closes_on')->nullable();
                $table->unsignedInteger('created_by')->nullable();
                $table->timestamps();
                $table->softDeletes();
                $table->index('workspace_id');
                $table->index(['project_id', 'id']);
                $table->foreign('project_id')->references('id')->on('projects')->cascadeOnDelete();
                $table->foreign('workspace_id')->references('id')->on('workspaces')->cascadeOnDelete();
                $table->foreign('created_by')->references('id')->on('users')->nullOnDelete();
            });
        }

        if (! Schema::hasTable('form_submissions')) {
            Schema::create('form_submissions', function (Blueprint $table) {
                $table->increments('id');
                $table->unsignedInteger('workspace_id');
                $table->unsignedInteger('project_form_id');
                $table->unsignedInteger('project_id');
                $table->string('reference', 24)->unique();
                $table->string('from_name', 120)->nullable();
                $table->string('from_email', 190)->nullable();
                $table->json('answers');
                $table->json('form_snapshot');
                $table->string('status', 16)->default('new');
                $table->unsignedInteger('task_id')->nullable()->index();
                $table->unsignedInteger('possible_duplicate_of')->nullable();
                $table->text('decline_reason')->nullable();
                $table->unsignedInteger('decided_by')->nullable();
                $table->dateTime('decided_at')->nullable();
                $table->string('ip_hash', 64)->nullable();
                $table->string('user_agent', 500)->nullable();
                $table->timestamp('created_at')->useCurrent();
                $table->index(['project_form_id', 'status', 'id']);
                $table->index(['workspace_id', 'status']);
                $table->index(['from_email', 'created_at']);
                $table->foreign('workspace_id')->references('id')->on('workspaces')->cascadeOnDelete();
                $table->foreign('project_form_id')->references('id')->on('project_forms')->cascadeOnDelete();
                $table->foreign('project_id')->references('id')->on('projects')->cascadeOnDelete();
                $table->foreign('possible_duplicate_of')->references('id')->on('form_submissions')->nullOnDelete();
                $table->foreign('decided_by')->references('id')->on('users')->nullOnDelete();
            });
        }

        if (! Schema::hasTable('form_submission_files')) {
            Schema::create('form_submission_files', function (Blueprint $table) {
                $table->increments('id');
                $table->unsignedInteger('form_submission_id');
                $table->string('original_name');
                $table->string('file_name');
                $table->string('storage_path', 500);
                $table->string('mime_type', 191)->nullable();
                $table->unsignedBigInteger('file_size')->default(0);
                $table->string('storage_driver', 32)->default('local');
                $table->timestamp('created_at')->useCurrent();
                $table->softDeletes();
                $table->foreign('form_submission_id')->references('id')->on('form_submissions')->cascadeOnDelete();
            });
        }

        if (! Schema::hasColumn('tasks', 'form_submission_id')) {
            Schema::table('tasks', function (Blueprint $table) {
                $table->unsignedInteger('form_submission_id')->nullable()->unique()->after('created_by');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('tasks', 'form_submission_id')) {
            Schema::table('tasks', function (Blueprint $table) {
                $table->dropUnique(['form_submission_id']);
                $table->dropColumn('form_submission_id');
            });
        }
        Schema::dropIfExists('form_submission_files');
        Schema::dropIfExists('form_submissions');
        Schema::dropIfExists('project_forms');
    }
};
