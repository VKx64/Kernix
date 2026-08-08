<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('time_entries')) {
            return;
        }

        Schema::create('time_entries', function (Blueprint $table) {
            $table->id();
            $table->unsignedInteger('user_id');
            // The attendance session the entry happened inside. Nullable so an
            // entry survives a session being reworked, not because it is optional.
            $table->unsignedBigInteger('session_id')->nullable();
            $table->unsignedInteger('task_id')->nullable();
            // work: time that lands on a task. break: paused time, which keeps
            // the task so resuming knows where to return.
            $table->string('kind', 16);
            $table->string('break_kind', 32)->nullable();
            // 0 means open-ended: the break has no expected end.
            $table->unsignedInteger('break_due_minutes')->nullable();
            $table->dateTime('started_at');
            $table->dateTime('ended_at')->nullable();
            $table->timestamps();
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->foreign('session_id')->references('id')->on('time_sessions')->cascadeOnDelete();
            $table->foreign('task_id')->references('id')->on('tasks')->nullOnDelete();
            $table->index('user_id');
            // Every read is one person's day or week.
            $table->index(['user_id', 'started_at']);
            $table->index('task_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('time_entries');
    }
};
