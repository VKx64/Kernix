<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * An Oliver action outlives the message that announced it.
 *
 * `oliver_actions.message_id` cascaded on delete, so "Clear conversation" — a
 * housekeeping action about chat history — also destroyed the record of every
 * change Oliver had made. The task edits themselves stayed, which is the worst
 * of both: the work was still changed, but the audit row and the ability to
 * undo it were gone, and the "acted today" rail came back empty.
 *
 * The column is already nullable, so the link simply drops away and the action
 * survives on its own.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('oliver_actions', function (Blueprint $table) {
            $table->dropForeign(['message_id']);
            $table->foreign('message_id')->references('id')->on('oliver_messages')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('oliver_actions', function (Blueprint $table) {
            $table->dropForeign(['message_id']);
            $table->foreign('message_id')->references('id')->on('oliver_messages')->cascadeOnDelete();
        });
    }
};
