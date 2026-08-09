<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('task_note_reactions')) {
            return;
        }

        Schema::create('task_note_reactions', function (Blueprint $table) {
            $table->id();
            $table->unsignedInteger('task_note_id');
            $table->unsignedInteger('user_id');
            $table->string('emoji', 16);
            $table->timestamps();
            $table->foreign('task_note_id')->references('id')->on('task_notes')->cascadeOnDelete();
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->unique(['task_note_id', 'user_id', 'emoji']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('task_note_reactions');
    }
};
