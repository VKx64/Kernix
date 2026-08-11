<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('task_folders', function (Blueprint $table) {
            $table->unsignedInteger('parent_id')->nullable()->after('project_id');
            // A parent is only ever removed by the controller, which promotes
            // the children first. The cascade is the safety net for a folder
            // deleted outside the app: its children become top level rather
            // than vanishing with it.
            $table->foreign('parent_id')->references('id')->on('task_folders')->nullOnDelete();
            $table->index(['project_id', 'parent_id', 'sort_order']);
        });

        // Sibling names, not project-wide names: "Drafts" may exist under two
        // different parents. Both engines treat NULLs as distinct in a unique
        // index, so this does not constrain top-level folders; the controller
        // validates those against their siblings.
        Schema::table('task_folders', function (Blueprint $table) {
            $table->dropUnique(['project_id', 'name']);
            $table->unique(['project_id', 'parent_id', 'name']);
        });
    }

    public function down(): void
    {
        Schema::table('task_folders', function (Blueprint $table) {
            $table->dropUnique(['project_id', 'parent_id', 'name']);
            $table->unique(['project_id', 'name']);
        });

        Schema::table('task_folders', function (Blueprint $table) {
            $table->dropForeign(['parent_id']);
            $table->dropIndex(['project_id', 'parent_id', 'sort_order']);
            $table->dropColumn('parent_id');
        });
    }
};
