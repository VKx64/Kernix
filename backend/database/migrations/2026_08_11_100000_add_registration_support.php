<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Somebody who registers without an invitation has no workspace yet, so there is
 * no workspace role for them to hold either. The legacy column becomes optional
 * to describe that state; every account that already has a role keeps it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->unsignedInteger('role_id')->nullable()->change();
        });
    }

    public function down(): void
    {
        // A not-null column needs every row to have a value, so accounts still
        // waiting to onboard fall back to the first role.
        $fallbackRoleId = DB::table('roles')->orderBy('id')->value('id');
        if ($fallbackRoleId) {
            DB::table('users')->whereNull('role_id')->update(['role_id' => $fallbackRoleId]);
        }

        Schema::table('users', function (Blueprint $table) {
            $table->unsignedInteger('role_id')->nullable(false)->change();
        });
    }
};
