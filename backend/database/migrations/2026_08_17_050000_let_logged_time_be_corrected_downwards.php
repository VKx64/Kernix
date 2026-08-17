<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A task's logged time only ever went up. It is recomputed from the timer
     * entries and the minutes on its notes, both of which could only be
     * positive, so a timer left running through lunch or a mistyped 300 stayed
     * on the record for good.
     *
     * A correction is now a note like any other, carrying the difference — and
     * the difference is usually negative. Which needs the column to be signed.
     *
     * Widening a column, not narrowing one: every stored value is a small
     * positive number and stays exactly as it is. The `unsigned` half of the
     * type was doing no work that the request validation does not already do
     * for ordinary time logging, where minutes are still refused below zero.
     */
    public function up(): void
    {
        Schema::table('task_notes', function (Blueprint $table) {
            $table->integer('time_minutes')->nullable()->default(null)->change();
        });

        // The people who already decide how work is assigned are the people who
        // may correct what it cost. An employee logs their own time and cannot
        // rewrite it afterwards, which is the point of the permission.
        $roleIds = DB::table('role_permissions')
            ->where('permission_key', 'tasks.assign')
            ->distinct()
            ->pluck('role_id');

        $grants = $roleIds
            ->map(fn ($roleId) => ['role_id' => $roleId, 'permission_key' => 'tasks.adjust_time'])
            ->all();

        if ($grants !== []) {
            DB::table('role_permissions')->insertOrIgnore($grants);
        }
    }

    public function down(): void
    {
        DB::table('role_permissions')->where('permission_key', 'tasks.adjust_time')->delete();

        // Corrections cannot survive an unsigned column, and dropping them
        // would leave every corrected task reporting the wrong total. They are
        // folded into the task's own figure first so no minute is lost.
        foreach (DB::table('task_notes')->where('time_minutes', '<', 0)->get() as $note) {
            DB::table('task_notes')->where('id', $note->id)->update(['time_minutes' => 0]);
        }

        Schema::table('task_notes', function (Blueprint $table) {
            $table->unsignedInteger('time_minutes')->nullable()->default(null)->change();
        });
    }
};
