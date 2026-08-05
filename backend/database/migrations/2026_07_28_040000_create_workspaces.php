<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /** Tenant data: each row belongs to exactly one workspace. */
    private const SCOPED_TABLES = ['clients', 'contacts', 'projects', 'tasks'];

    public function up(): void
    {
        if (! Schema::hasTable('workspaces')) {
            Schema::create('workspaces', function (Blueprint $table) {
                $table->increments('id');
                $table->string('name', 191);
                $table->string('slug', 191)->unique();
                $table->unsignedInteger('created_by')->nullable();
                $table->timestamps();
                $table->softDeletes();
                $table->foreign('created_by')->references('id')->on('users')->nullOnDelete();
            });
        }

        if (! Schema::hasTable('workspace_user')) {
            Schema::create('workspace_user', function (Blueprint $table) {
                $table->increments('id');
                $table->unsignedInteger('workspace_id');
                $table->unsignedInteger('user_id');
                $table->timestamps();
                $table->unique(['workspace_id', 'user_id']);
                $table->foreign('workspace_id')->references('id')->on('workspaces')->cascadeOnDelete();
                $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            });
        }

        if (! Schema::hasColumn('users', 'active_workspace_id')) {
            Schema::table('users', function (Blueprint $table) {
                $table->unsignedInteger('active_workspace_id')->nullable()->after('role_id');
                $table->foreign('active_workspace_id')->references('id')->on('workspaces')->nullOnDelete();
            });
        }

        foreach (self::SCOPED_TABLES as $name) {
            if (Schema::hasTable($name) && ! Schema::hasColumn($name, 'workspace_id')) {
                Schema::table($name, function (Blueprint $table) {
                    $table->unsignedInteger('workspace_id')->nullable()->index();
                });
            }
        }

        // Everything that exists today belongs to one workspace, so no row is
        // orphaned and nothing disappears from the interface after upgrading.
        $workspaceId = DB::table('workspaces')->value('id');
        if (! $workspaceId) {
            $workspaceId = DB::table('workspaces')->insertGetId([
                'name' => config('app.name', 'Workspace'),
                'slug' => 'default',
                'created_by' => DB::table('users')->min('id'),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        foreach (self::SCOPED_TABLES as $name) {
            if (Schema::hasTable($name)) {
                DB::table($name)->whereNull('workspace_id')->update(['workspace_id' => $workspaceId]);
            }
        }

        $memberships = DB::table('users')->pluck('id')->map(fn ($userId) => [
            'workspace_id' => $workspaceId,
            'user_id' => $userId,
            'created_at' => now(),
            'updated_at' => now(),
        ])->all();
        if ($memberships !== []) {
            DB::table('workspace_user')->insertOrIgnore($memberships);
        }
        DB::table('users')->whereNull('active_workspace_id')->update(['active_workspace_id' => $workspaceId]);
    }

    public function down(): void
    {
        foreach (self::SCOPED_TABLES as $name) {
            if (Schema::hasTable($name) && Schema::hasColumn($name, 'workspace_id')) {
                Schema::table($name, fn (Blueprint $table) => $table->dropColumn('workspace_id'));
            }
        }
        if (Schema::hasColumn('users', 'active_workspace_id')) {
            Schema::table('users', function (Blueprint $table) {
                $table->dropForeign(['active_workspace_id']);
                $table->dropColumn('active_workspace_id');
            });
        }
        Schema::dropIfExists('workspace_user');
        Schema::dropIfExists('workspaces');
    }
};
