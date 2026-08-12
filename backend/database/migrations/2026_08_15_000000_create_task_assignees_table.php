<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('task_assignees')) {
            return;
        }

        Schema::create('task_assignees', function (Blueprint $table) {
            // Auto-increment `id` is the deterministic ordering: rows are
            // always inserted in the order assignees should render, so
            // "first assignee" is `orderBy('task_assignees.id')`, not
            // whatever order the query planner happens to pick.
            $table->id();
            $table->unsignedInteger('task_id');
            $table->unsignedInteger('user_id');
            $table->timestamps();
            $table->foreign('task_id')->references('id')->on('tasks')->cascadeOnDelete();
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->unique(['task_id', 'user_id']);
        });

        // Backfill: one pivot row per task that already carries a legacy
        // assignee, in task id order, so id order below equals creation order.
        DB::table('tasks')
            ->whereNotNull('assignee_user_id')
            ->orderBy('id')
            ->select('id', 'assignee_user_id')
            ->chunkById(500, function ($tasks) {
                $now = now();
                $rows = $tasks->map(fn ($task) => [
                    'task_id' => $task->id,
                    'user_id' => $task->assignee_user_id,
                    'created_at' => $now,
                    'updated_at' => $now,
                ])->all();
                if ($rows !== []) {
                    DB::table('task_assignees')->insert($rows);
                }
            });
    }

    public function down(): void
    {
        Schema::dropIfExists('task_assignees');
    }
};
