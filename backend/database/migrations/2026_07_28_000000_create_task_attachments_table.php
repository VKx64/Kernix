<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('task_attachments')) {
            return;
        }

        Schema::create('task_attachments', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('task_id');
            $table->string('original_name');
            $table->string('file_name');
            $table->string('storage_path', 500);
            $table->string('mime_type', 191)->nullable();
            $table->unsignedBigInteger('file_size')->default(0);
            $table->string('storage_driver', 32)->default('local');
            $table->unsignedInteger('uploaded_by')->nullable();
            $table->timestamp('created_at')->useCurrent();
            $table->softDeletes();
            $table->foreign('task_id')->references('id')->on('tasks')->cascadeOnDelete();
            $table->foreign('uploaded_by')->references('id')->on('users')->nullOnDelete();
            $table->index(['task_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('task_attachments');
    }
};
