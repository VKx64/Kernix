<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('clients', 'retainer_minutes')) {
            return;
        }

        Schema::table('clients', function (Blueprint $table) {
            // A monthly allowance of work, not money. Null means the client has
            // no retainer at all: they sit out of every burn calculation rather
            // than counting as a zero allowance.
            $table->unsignedInteger('retainer_minutes')->nullable()->after('timezone');
        });
    }

    public function down(): void
    {
        Schema::table('clients', function (Blueprint $table) {
            $table->dropColumn('retainer_minutes');
        });
    }
};
