<?php

use App\Support\WorkspaceFeatures;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // An earlier shape of this slice asked every employee to pair their own
        // number. One account speaks for the whole workspace instead, so the
        // table that held per-person pairings is gone if it was ever created.
        Schema::dropIfExists('whatsapp_links');

        if (! Schema::hasTable('whatsapp_chats')) {
            Schema::create('whatsapp_chats', function (Blueprint $table) {
                $table->increments('id');
                // One linked account can serve several workspaces, and the rows a
                // chat produces (tasks, notes) are scoped, so the chat is too.
                // Stamped from whoever the number resolved to, falling back to
                // the deployment's own first workspace for a stranger.
                $table->unsignedInteger('workspace_id')->nullable()->index();
                // The WhatsApp identity: a person's number, or a group id.
                $table->string('jid', 64)->unique();
                // direct | group
                $table->string('kind', 8);
                // Push name for a person, subject for a group. Display only.
                $table->string('subject', 191)->nullable();
                // Who this chat turned out to be. staff | client | unknown.
                // Resolved from the numbers already on the personnel and contact
                // records, so nobody has to pair anything.
                $table->string('audience', 16)->default('unknown');
                $table->unsignedInteger('user_id')->nullable()->index();
                $table->unsignedInteger('contact_id')->nullable()->index();
                $table->unsignedInteger('client_id')->nullable()->index();
                // Where work from this chat lands. Required before a task can be
                // raised from a group, and set by an operator or by `link
                // project <id>` from a staff number in the chat itself.
                $table->unsignedInteger('project_id')->nullable()->index();
                // Whether the assistant may read this chat and raise work from
                // it. Off means it still logs and still delivers, but never acts.
                $table->boolean('intake_enabled')->default(true);
                // Nothing is delivered to a muted chat.
                $table->boolean('muted')->default(false);
                $table->timestamp('last_inbound_at')->nullable();
                $table->timestamp('last_digest_at')->nullable();
                $table->timestamps();
                $table->foreign('workspace_id')->references('id')->on('workspaces')->nullOnDelete();
                $table->foreign('user_id')->references('id')->on('users')->nullOnDelete();
                $table->foreign('contact_id')->references('id')->on('contacts')->nullOnDelete();
                $table->foreign('client_id')->references('id')->on('clients')->nullOnDelete();
                $table->foreign('project_id')->references('id')->on('projects')->nullOnDelete();
            });
        }

        if (! Schema::hasTable('whatsapp_messages')) {
            Schema::create('whatsapp_messages', function (Blueprint $table) {
                $table->increments('id');
                $table->unsignedInteger('workspace_id')->nullable()->index();
                $table->unsignedInteger('chat_id')->nullable()->index();
                // Who sent it, when the number belongs to a Kernix account. Null
                // for a client, a stranger, or anything the assistant said.
                $table->unsignedInteger('user_id')->nullable()->index();
                $table->string('jid', 64)->index();
                // In a group, the number of the individual who spoke, which is
                // not the chat's own jid.
                $table->string('sender_jid', 64)->nullable();
                $table->string('sender_name', 191)->nullable();
                $table->string('direction', 8);
                $table->text('body');
                $table->string('wa_message_id', 96)->nullable()->index();
                $table->unsignedInteger('task_id')->nullable();
                $table->unsignedInteger('conversation_id')->nullable();
                // received | handled | ignored | queued | sent | failed
                $table->string('status', 16)->default('received');
                $table->text('error')->nullable();
                $table->timestamps();
                $table->foreign('chat_id')->references('id')->on('whatsapp_chats')->cascadeOnDelete();
                $table->foreign('user_id')->references('id')->on('users')->nullOnDelete();
            });
        }

        Schema::table('workspaces', function (Blueprint $table) {
            $column = WorkspaceFeatures::enabledColumn(WorkspaceFeatures::WHATSAPP);
            if (! Schema::hasColumn('workspaces', $column)) {
                // default(false), unlike every other feature: this one reaches
                // outside the app and sends messages to real phones, so an
                // existing workspace must switch it on deliberately.
                $table->boolean($column)->default(false)->nullable(false);
            }
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('whatsapp_messages');
        Schema::dropIfExists('whatsapp_chats');

        Schema::table('workspaces', function (Blueprint $table) {
            $column = WorkspaceFeatures::enabledColumn(WorkspaceFeatures::WHATSAPP);
            if (Schema::hasColumn('workspaces', $column)) {
                $table->dropColumn($column);
            }
        });
    }
};
