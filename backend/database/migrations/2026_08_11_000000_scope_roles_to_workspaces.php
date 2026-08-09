<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Roles used to be global: every tenant shared one list of roles and one set of
 * permissions. This scopes them to a workspace and moves the person's role onto
 * their workspace membership, so the same account can be an administrator in one
 * workspace and an employee in another.
 *
 * `users.role_id` stays exactly where it is. It is the fallback the model reads
 * when a membership row carries no role yet, and it is what a rollback restores
 * to, so no existing account loses permissions on the way through.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('roles', 'workspace_id')) {
            Schema::table('roles', function (Blueprint $table) {
                $table->unsignedInteger('workspace_id')->nullable()->index();
            });
        }

        if (! Schema::hasColumn('role_permissions', 'workspace_id')) {
            Schema::table('role_permissions', function (Blueprint $table) {
                $table->unsignedInteger('workspace_id')->nullable()->index();
            });
        }

        if (! Schema::hasColumn('workspace_user', 'role_id')) {
            Schema::table('workspace_user', function (Blueprint $table) {
                $table->unsignedInteger('role_id')->nullable()->index();
            });
        }

        $this->backfill();

        // A key name only has to be distinct inside its own workspace now, and
        // every workspace seeds the same starter keys.
        if (Schema::hasIndex('roles', 'roles_key_name_unique')) {
            Schema::table('roles', fn (Blueprint $table) => $table->dropUnique('roles_key_name_unique'));
        }
        if (! Schema::hasIndex('roles', 'roles_workspace_id_key_name_unique')) {
            Schema::table('roles', fn (Blueprint $table) => $table->unique(['workspace_id', 'key_name']));
        }
    }

    public function down(): void
    {
        if (Schema::hasIndex('roles', 'roles_workspace_id_key_name_unique')) {
            Schema::table('roles', fn (Blueprint $table) => $table->dropUnique('roles_workspace_id_key_name_unique'));
        }
        // Only restorable while the key names are still globally distinct, which
        // they are until a second workspace has seeded its own roles.
        $duplicated = DB::table('roles')->select('key_name')->groupBy('key_name')->havingRaw('count(*) > 1')->exists();
        if (! $duplicated && ! Schema::hasIndex('roles', 'roles_key_name_unique')) {
            Schema::table('roles', fn (Blueprint $table) => $table->unique('key_name'));
        }

        if (Schema::hasColumn('workspace_user', 'role_id')) {
            Schema::table('workspace_user', fn (Blueprint $table) => $table->dropColumn('role_id'));
        }
        if (Schema::hasColumn('role_permissions', 'workspace_id')) {
            Schema::table('role_permissions', fn (Blueprint $table) => $table->dropColumn('workspace_id'));
        }
        if (Schema::hasColumn('roles', 'workspace_id')) {
            Schema::table('roles', fn (Blueprint $table) => $table->dropColumn('workspace_id'));
        }
    }

    /**
     * Everything that exists today belongs to the first workspace, and every
     * membership inherits the role the account already had, so effective
     * permissions are unchanged for every existing user.
     */
    private function backfill(): void
    {
        $workspaceId = DB::table('workspaces')->orderBy('id')->value('id');
        if ($workspaceId) {
            DB::table('roles')->whereNull('workspace_id')->update(['workspace_id' => $workspaceId]);
            DB::table('role_permissions')->whereNull('workspace_id')->update(['workspace_id' => $workspaceId]);
        }

        $now = now();
        DB::table('users')->orderBy('id')->select(['id', 'role_id', 'active_workspace_id'])
            ->chunk(200, function ($users) use ($now): void {
                foreach ($users as $user) {
                    if (! $user->role_id) {
                        continue;
                    }

                    DB::table('workspace_user')
                        ->where('user_id', $user->id)
                        ->whereNull('role_id')
                        ->update(['role_id' => $user->role_id, 'updated_at' => $now]);

                    // Somebody pointed at a workspace they were never a member
                    // of would otherwise sign in with no role at all.
                    if (! $user->active_workspace_id) {
                        continue;
                    }
                    $membershipExists = DB::table('workspace_user')
                        ->where('user_id', $user->id)
                        ->where('workspace_id', $user->active_workspace_id)
                        ->exists();
                    if (! $membershipExists) {
                        DB::table('workspace_user')->insert([
                            'workspace_id' => $user->active_workspace_id,
                            'user_id' => $user->id,
                            'role_id' => $user->role_id,
                            'created_at' => $now,
                            'updated_at' => $now,
                        ]);
                    }
                }
            });
    }
};
