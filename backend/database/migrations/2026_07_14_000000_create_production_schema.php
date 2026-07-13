<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('roles', function (Blueprint $table) {
            $table->increments('id');
            $table->string('name', 128);
            $table->string('key_name', 128)->unique();
            $table->boolean('is_system')->default(false);
            $table->integer('sort_order')->default(0);
            $table->timestamps();
            $table->softDeletes();
        });

        Schema::create('role_permissions', function (Blueprint $table) {
            $table->unsignedInteger('role_id');
            $table->string('permission_key', 128);
            $table->primary(['role_id', 'permission_key']);
            $table->foreign('role_id')->references('id')->on('roles')->cascadeOnDelete();
        });

        Schema::create('fields', function (Blueprint $table) {
            $table->increments('id');
            $table->string('name', 128);
            $table->string('key_name', 128)->unique();
            $table->string('description')->nullable();
            $table->boolean('is_system')->default(true);
            $table->integer('sort_order')->default(0);
            $table->timestamps();
            $table->softDeletes();
        });

        Schema::create('field_values', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('field_id');
            $table->string('label', 128);
            $table->string('key_name', 128);
            $table->string('color', 32)->nullable();
            $table->string('status', 24)->default('active');
            $table->integer('sort_order')->default(0);
            $table->timestamps();
            $table->softDeletes();
            $table->unique(['field_id', 'key_name']);
            $table->foreign('field_id')->references('id')->on('fields')->cascadeOnDelete();
        });

        Schema::create('users', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('role_id');
            $table->string('username', 128)->unique();
            $table->string('password_hash');
            $table->string('first_name', 64);
            $table->string('last_name', 64)->default('');
            $table->string('imagic_email', 191)->nullable();
            $table->string('personal_email', 191)->nullable();
            $table->string('phone_1', 64)->nullable();
            $table->string('phone_2', 64)->nullable();
            $table->unsignedInteger('department_value_id')->nullable();
            $table->string('wise_account', 191)->nullable();
            $table->string('gcash_account', 191)->nullable();
            $table->date('start_date')->nullable();
            $table->date('birthdate')->nullable();
            $table->string('status', 24)->default('active');
            $table->text('home_address')->nullable();
            $table->string('barangay', 128)->nullable();
            $table->string('city', 128)->nullable();
            $table->string('province', 128)->nullable();
            $table->string('zip_code', 32)->nullable();
            $table->string('timezone', 64)->nullable();
            $table->string('profile_image', 500)->nullable();
            $table->string('theme_preset', 64)->default('imagic_purple');
            $table->dateTime('last_login_at')->nullable();
            $table->string('last_login_ip', 45)->nullable();
            $table->rememberToken();
            $table->timestamps();
            $table->dateTime('archived_at')->nullable();
            $table->softDeletes();
            $table->foreign('role_id')->references('id')->on('roles');
            $table->foreign('department_value_id')->references('id')->on('field_values')->nullOnDelete();
        });

        Schema::create('clients', function (Blueprint $table) {
            $table->increments('id');
            $table->string('name', 191);
            $table->string('website', 500)->nullable();
            $table->string('email', 191)->nullable();
            $table->string('phone', 64)->nullable();
            $table->text('address')->nullable();
            $table->string('city', 128)->nullable();
            $table->string('province', 128)->nullable();
            $table->string('zip_code', 32)->nullable();
            $table->string('country', 128)->nullable();
            $table->string('timezone', 64)->nullable();
            $table->text('notes')->nullable();
            $table->unsignedInteger('status_value_id')->nullable();
            $table->unsignedInteger('created_by')->nullable();
            $table->timestamps();
            $table->dateTime('archived_at')->nullable();
            $table->softDeletes();
            $table->foreign('status_value_id')->references('id')->on('field_values')->nullOnDelete();
            $table->foreign('created_by')->references('id')->on('users')->nullOnDelete();
        });

        Schema::create('contacts', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('client_id');
            $table->string('first_name', 128);
            $table->string('last_name', 128)->default('');
            $table->string('title', 191)->nullable();
            $table->string('email', 191)->nullable();
            $table->string('phone_1', 64)->nullable();
            $table->string('phone_2', 64)->nullable();
            $table->text('notes')->nullable();
            $table->string('status', 24)->default('active');
            $table->unsignedInteger('created_by')->nullable();
            $table->timestamps();
            $table->dateTime('archived_at')->nullable();
            $table->softDeletes();
            $table->foreign('client_id')->references('id')->on('clients');
            $table->foreign('created_by')->references('id')->on('users')->nullOnDelete();
        });

        Schema::create('projects', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('client_id');
            $table->string('name', 191);
            $table->text('description')->nullable();
            $table->unsignedInteger('status_value_id')->nullable();
            $table->unsignedInteger('manager_user_id')->nullable();
            $table->date('start_date')->nullable();
            $table->date('due_date')->nullable();
            $table->unsignedInteger('created_by')->nullable();
            $table->timestamps();
            $table->dateTime('archived_at')->nullable();
            $table->softDeletes();
            $table->foreign('client_id')->references('id')->on('clients');
            $table->foreign('status_value_id')->references('id')->on('field_values')->nullOnDelete();
            $table->foreign('manager_user_id')->references('id')->on('users')->nullOnDelete();
            $table->foreign('created_by')->references('id')->on('users')->nullOnDelete();
        });

        Schema::create('tasks', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('project_id');
            $table->string('title');
            $table->longText('description')->nullable();
            $table->unsignedInteger('status_value_id')->nullable();
            $table->unsignedInteger('type_value_id')->nullable();
            $table->unsignedInteger('urgency_value_id')->nullable();
            $table->date('due_date')->nullable();
            $table->unsignedInteger('assignee_user_id')->nullable();
            $table->unsignedInteger('estimated_minutes')->nullable();
            $table->unsignedInteger('actual_minutes')->default(0);
            $table->unsignedInteger('created_by')->nullable();
            $table->timestamps();
            $table->dateTime('archived_at')->nullable();
            $table->softDeletes();
            $table->foreign('project_id')->references('id')->on('projects');
            $table->foreign('status_value_id')->references('id')->on('field_values')->nullOnDelete();
            $table->foreign('type_value_id')->references('id')->on('field_values')->nullOnDelete();
            $table->foreign('urgency_value_id')->references('id')->on('field_values')->nullOnDelete();
            $table->foreign('assignee_user_id')->references('id')->on('users')->nullOnDelete();
            $table->foreign('created_by')->references('id')->on('users')->nullOnDelete();
        });

        Schema::create('task_subtasks', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('task_id');
            $table->string('title');
            $table->unsignedInteger('status_value_id')->nullable();
            $table->unsignedInteger('assignee_user_id')->nullable();
            $table->date('due_date')->nullable();
            $table->unsignedInteger('estimated_minutes')->nullable();
            $table->unsignedInteger('actual_minutes')->default(0);
            $table->integer('sort_order')->default(0);
            $table->dateTime('completed_at')->nullable();
            $table->unsignedInteger('created_by')->nullable();
            $table->timestamps();
            $table->softDeletes();
            $table->foreign('task_id')->references('id')->on('tasks')->cascadeOnDelete();
            $table->foreign('status_value_id')->references('id')->on('field_values')->nullOnDelete();
            $table->foreign('assignee_user_id')->references('id')->on('users')->nullOnDelete();
            $table->foreign('created_by')->references('id')->on('users')->nullOnDelete();
        });

        Schema::create('task_notes', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('task_id');
            $table->unsignedInteger('subtask_id')->nullable();
            $table->longText('body');
            $table->unsignedInteger('time_minutes')->nullable();
            $table->unsignedInteger('time_logged_by')->nullable();
            $table->unsignedInteger('assigned_user_id')->nullable();
            $table->unsignedInteger('created_by')->nullable();
            $table->boolean('is_message')->default(false);
            $table->dateTime('read_at')->nullable();
            $table->unsignedInteger('read_by_user_id')->nullable();
            $table->timestamps();
            $table->softDeletes();
            $table->foreign('task_id')->references('id')->on('tasks')->cascadeOnDelete();
            $table->foreign('subtask_id')->references('id')->on('task_subtasks')->nullOnDelete();
            $table->foreign('time_logged_by')->references('id')->on('users')->nullOnDelete();
            $table->foreign('assigned_user_id')->references('id')->on('users')->nullOnDelete();
            $table->foreign('created_by')->references('id')->on('users')->nullOnDelete();
            $table->foreign('read_by_user_id')->references('id')->on('users')->nullOnDelete();
        });

        Schema::create('note_attachments', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('note_id');
            $table->string('original_name');
            $table->string('file_name');
            $table->string('storage_path', 500);
            $table->string('mime_type', 191)->nullable();
            $table->unsignedBigInteger('file_size')->default(0);
            $table->string('storage_driver', 32)->default('local');
            $table->unsignedInteger('uploaded_by')->nullable();
            $table->timestamp('created_at')->useCurrent();
            $table->softDeletes();
            $table->foreign('note_id')->references('id')->on('task_notes')->cascadeOnDelete();
            $table->foreign('uploaded_by')->references('id')->on('users')->nullOnDelete();
        });

        Schema::create('task_emails', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('task_id');
            $table->unsignedInteger('sent_by')->nullable();
            $table->text('to_addresses');
            $table->text('cc_addresses')->nullable();
            $table->text('bcc_addresses')->nullable();
            $table->string('subject', 500);
            $table->longText('body');
            $table->string('status', 32)->default('queued');
            $table->text('error_message')->nullable();
            $table->dateTime('sent_at')->nullable();
            $table->timestamps();
            $table->softDeletes();
            $table->foreign('task_id')->references('id')->on('tasks')->cascadeOnDelete();
            $table->foreign('sent_by')->references('id')->on('users')->nullOnDelete();
        });

        Schema::create('email_attachments', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('email_id');
            $table->string('file_name');
            $table->string('original_name');
            $table->string('mime_type', 191)->nullable();
            $table->unsignedBigInteger('file_size')->default(0);
            $table->string('storage_driver', 32)->default('local');
            $table->string('storage_path', 500);
            $table->timestamp('created_at')->useCurrent();
            $table->softDeletes();
            $table->foreign('email_id')->references('id')->on('task_emails')->cascadeOnDelete();
        });

        Schema::create('time_sessions', function (Blueprint $table) {
            $table->id();
            $table->unsignedInteger('user_id');
            $table->dateTime('clock_in_at');
            $table->dateTime('clock_out_at')->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();
            $table->foreign('user_id')->references('id')->on('users');
        });

        Schema::create('time_breaks', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('session_id');
            $table->dateTime('start_at');
            $table->dateTime('end_at')->nullable();
            $table->timestamps();
            $table->foreign('session_id')->references('id')->on('time_sessions')->cascadeOnDelete();
        });

        Schema::create('audit_logs', function (Blueprint $table) {
            $table->id();
            $table->unsignedInteger('user_id')->nullable();
            $table->string('action', 64);
            $table->string('entity_type', 64)->nullable();
            $table->unsignedBigInteger('entity_id')->nullable();
            $table->string('summary', 500)->nullable();
            $table->longText('changes_json')->nullable();
            $table->string('ip_address', 45)->nullable();
            $table->string('user_agent', 500)->nullable();
            $table->timestamp('created_at')->useCurrent();
            $table->foreign('user_id')->references('id')->on('users')->nullOnDelete();
        });

        Schema::create('system_settings', function (Blueprint $table) {
            $table->unsignedTinyInteger('id')->primary();
            $table->string('default_timezone', 64)->default('Asia/Manila');
            $table->string('system_logo', 500)->nullable();
            $table->string('sidebar_logo', 500)->nullable();
            $table->string('email_logo', 500)->nullable();
            $table->string('favicon', 500)->nullable();
            $table->string('smtp_host')->nullable();
            $table->unsignedInteger('smtp_port')->default(587);
            $table->string('smtp_encryption', 16)->default('tls');
            $table->string('smtp_username')->nullable();
            $table->string('smtp_password', 500)->nullable();
            $table->string('smtp_from_email', 191)->nullable();
            $table->string('smtp_from_name', 191)->nullable();
            $table->string('storage_driver', 32)->default('local');
            $table->string('local_upload_path', 500)->default('uploads');
            $table->string('local_public_url', 500)->nullable();
            $table->string('s3_bucket')->nullable();
            $table->string('s3_region', 64)->nullable();
            $table->string('s3_access_key')->nullable();
            $table->string('s3_secret_key', 500)->nullable();
            $table->string('s3_endpoint', 500)->nullable();
            $table->string('s3_public_url_base', 500)->nullable();
            $table->boolean('s3_use_path_style')->default(false);
            $table->boolean('single_client_mode')->default(false);
            $table->unsignedInteger('single_client_id')->nullable();
            $table->timestamps();
            $table->foreign('single_client_id')->references('id')->on('clients')->nullOnDelete();
        });

        Schema::create('personal_access_tokens', function (Blueprint $table) {
            $table->id();
            $table->morphs('tokenable');
            $table->string('name');
            $table->string('token', 64)->unique();
            $table->text('abilities')->nullable();
            $table->timestamp('last_used_at')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();
        });

        Schema::create('sessions', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->unsignedInteger('user_id')->nullable()->index();
            $table->string('ip_address', 45)->nullable();
            $table->text('user_agent')->nullable();
            $table->longText('payload');
            $table->integer('last_activity')->index();
        });
    }

    public function down(): void
    {
        foreach (['sessions', 'personal_access_tokens', 'system_settings', 'audit_logs', 'time_breaks', 'time_sessions', 'email_attachments', 'task_emails', 'note_attachments', 'task_notes', 'task_subtasks', 'tasks', 'projects', 'contacts', 'clients', 'users', 'field_values', 'fields', 'role_permissions', 'roles'] as $table) {
            Schema::dropIfExists($table);
        }
    }
};
