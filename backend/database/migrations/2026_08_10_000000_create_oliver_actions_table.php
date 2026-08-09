<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('oliver_actions')) {
            return;
        }

        Schema::create('oliver_actions', function (Blueprint $table) {
            $table->id();
            $table->unsignedInteger('user_id');
            // The turn the action belonged to. Nullable because the row is
            // written while the action runs, before the reply it belongs to
            // exists, and because a cleared conversation must not erase history.
            $table->unsignedInteger('message_id')->nullable();
            $table->string('type', 32);
            $table->string('entity_type', 64);
            $table->unsignedInteger('entity_id');
            // Only what a reversal needs, never a whole record.
            $table->json('before')->nullable();
            // What the action set, both for display and to detect a later edit.
            $table->json('after')->nullable();
            $table->string('summary', 255);
            $table->timestamp('undone_at')->nullable();
            $table->timestamps();
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->foreign('message_id')->references('id')->on('oliver_messages')->cascadeOnDelete();
            $table->index('user_id');
            // Every read is one person's recent actions, newest first.
            $table->index(['user_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('oliver_actions');
    }
};
