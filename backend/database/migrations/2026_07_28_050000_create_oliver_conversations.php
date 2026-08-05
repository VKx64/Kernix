<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('oliver_conversations')) {
            Schema::create('oliver_conversations', function (Blueprint $table) {
                $table->increments('id');
                $table->unsignedInteger('workspace_id')->nullable()->index();
                $table->unsignedInteger('user_id');
                $table->string('title', 191)->default('Oliver');
                $table->timestamp('last_message_at')->nullable();
                $table->timestamps();
                $table->softDeletes();
                $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
                $table->index(['workspace_id', 'user_id']);
            });
        }

        if (! Schema::hasTable('oliver_messages')) {
            Schema::create('oliver_messages', function (Blueprint $table) {
                $table->increments('id');
                $table->unsignedInteger('conversation_id');
                $table->string('role', 16); // user | assistant
                $table->text('body');
                // What Oliver actually did, and whether each step succeeded.
                $table->json('actions')->nullable();
                $table->string('error_code', 64)->nullable();
                $table->timestamp('created_at')->useCurrent();
                $table->foreign('conversation_id')->references('id')->on('oliver_conversations')->cascadeOnDelete();
                $table->index(['conversation_id', 'id']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('oliver_messages');
        Schema::dropIfExists('oliver_conversations');
    }
};
