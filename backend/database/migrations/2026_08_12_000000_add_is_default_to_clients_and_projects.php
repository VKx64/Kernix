<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Marks the one hidden "General" client and "General" project a workspace
 * gets so it can turn the Clients or Projects surface off without breaking
 * the NOT NULL `client_id`/`project_id` foreign keys underneath contacts,
 * projects, and tasks. Every existing row starts false: nothing already in
 * the database was created as a stand-in.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('clients', function (Blueprint $table) {
            if (! Schema::hasColumn('clients', 'is_default')) {
                $table->boolean('is_default')->default(false)->nullable(false)->after('workspace_id');
            }
        });
        Schema::table('projects', function (Blueprint $table) {
            if (! Schema::hasColumn('projects', 'is_default')) {
                $table->boolean('is_default')->default(false)->nullable(false)->after('workspace_id');
            }
        });
    }

    public function down(): void
    {
        Schema::table('clients', function (Blueprint $table) {
            if (Schema::hasColumn('clients', 'is_default')) {
                $table->dropColumn('is_default');
            }
        });
        Schema::table('projects', function (Blueprint $table) {
            if (Schema::hasColumn('projects', 'is_default')) {
                $table->dropColumn('is_default');
            }
        });
    }
};
