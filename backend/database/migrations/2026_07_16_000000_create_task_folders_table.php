<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('task_folders', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('project_id');
            $table->string('name', 191);
            $table->integer('sort_order')->default(0);
            $table->unsignedInteger('created_by')->nullable();
            $table->timestamps();
            $table->unique(['project_id', 'name']);
            $table->index(['project_id', 'sort_order']);
            $table->foreign('project_id')->references('id')->on('projects')->cascadeOnDelete();
            $table->foreign('created_by')->references('id')->on('users')->nullOnDelete();
        });

        Schema::table('tasks', function (Blueprint $table) {
            $table->unsignedInteger('task_folder_id')->nullable();
            $table->foreign('task_folder_id')->references('id')->on('task_folders')->nullOnDelete();
            $table->index(['project_id', 'task_folder_id']);
        });
    }

    public function down(): void
    {
        Schema::table('tasks', function (Blueprint $table) {
            $table->dropForeign(['task_folder_id']);
            $table->dropIndex(['project_id', 'task_folder_id']);
            $table->dropColumn('task_folder_id');
        });

        Schema::dropIfExists('task_folders');
    }
};
