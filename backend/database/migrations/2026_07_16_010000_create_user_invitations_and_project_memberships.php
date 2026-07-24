<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('project_user', function (Blueprint $table) {
            $table->unsignedInteger('project_id');
            $table->unsignedInteger('user_id');
            $table->unsignedInteger('assigned_by')->nullable();
            $table->timestamps();
            $table->primary(['project_id', 'user_id']);
            $table->foreign('project_id')->references('id')->on('projects')->cascadeOnDelete();
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->foreign('assigned_by')->references('id')->on('users')->nullOnDelete();
        });

        Schema::create('user_invitations', function (Blueprint $table) {
            $table->id();
            $table->string('email', 191)->index();
            $table->char('token_hash', 64)->unique();
            $table->unsignedInteger('role_id');
            $table->unsignedInteger('invited_by')->nullable();
            $table->unsignedInteger('accepted_user_id')->nullable()->unique();
            $table->dateTime('expires_at')->index();
            $table->dateTime('accepted_at')->nullable();
            $table->dateTime('revoked_at')->nullable();
            $table->timestamps();
            $table->foreign('role_id')->references('id')->on('roles');
            $table->foreign('invited_by')->references('id')->on('users')->nullOnDelete();
            $table->foreign('accepted_user_id')->references('id')->on('users')->nullOnDelete();
        });

        Schema::create('invitation_project', function (Blueprint $table) {
            $table->unsignedBigInteger('user_invitation_id');
            $table->unsignedInteger('project_id');
            $table->timestamps();
            $table->primary(['user_invitation_id', 'project_id']);
            $table->foreign('user_invitation_id')->references('id')->on('user_invitations')->cascadeOnDelete();
            $table->foreign('project_id')->references('id')->on('projects')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('invitation_project');
        Schema::dropIfExists('user_invitations');
        Schema::dropIfExists('project_user');
    }
};
