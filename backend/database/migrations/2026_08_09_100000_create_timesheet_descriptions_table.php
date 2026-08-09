<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('timesheet_descriptions')) {
            return;
        }

        Schema::create('timesheet_descriptions', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('user_id');
            $table->unsignedInteger('task_id');
            $table->date('work_date');
            // What the person wants payroll to read. Absent, the timesheet
            // generates the line from the task title instead.
            $table->string('body', 500);
            $table->timestamps();
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->foreign('task_id')->references('id')->on('tasks')->cascadeOnDelete();
            // One override per person per task per day: the grain of a row.
            $table->unique(['user_id', 'task_id', 'work_date']);
            $table->index(['user_id', 'work_date']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('timesheet_descriptions');
    }
};
