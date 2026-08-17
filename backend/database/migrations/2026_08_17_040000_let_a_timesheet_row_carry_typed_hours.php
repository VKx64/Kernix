<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A finished task with no tracked time now appears on the timesheet with
     * its hours left blank, for the person to fill in. This is where that
     * number lives — beside the description override, keyed the same way, one
     * row per person per task per day.
     *
     * Null means "nothing typed", which is not the same as zero: zero is a
     * deliberate statement that the task took no billable time, and the two
     * must read differently on a payroll document.
     *
     * Nothing is read back out or deleted: existing rows keep their
     * description and gain a null. The only other change is that the
     * description itself may now be absent, which relaxes a constraint rather
     * than tightening one, so no stored row can fall foul of it.
     */
    public function up(): void
    {
        Schema::table('timesheet_descriptions', function (Blueprint $table) {
            $table->unsignedInteger('minutes')->nullable()->after('body');
            // The row is no longer only ever a description. Somebody who types
            // hours against a task whose generated line already reads correctly
            // has nothing to put here, and should not be made to invent one.
            $table->string('body', 500)->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('timesheet_descriptions', function (Blueprint $table) {
            $table->dropColumn('minutes');
        });

        // Rows kept only for their hours have no description to restore, so
        // they go rather than being given an invented one.
        DB::table('timesheet_descriptions')->whereNull('body')->delete();

        Schema::table('timesheet_descriptions', function (Blueprint $table) {
            $table->string('body', 500)->nullable(false)->change();
        });
    }
};
