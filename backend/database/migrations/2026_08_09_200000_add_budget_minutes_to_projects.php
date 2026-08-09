<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('projects', 'budget_minutes')) {
            return;
        }

        Schema::table('projects', function (Blueprint $table) {
            // A budget of work, not money: there are no rates anywhere in this
            // system. Null means the project has no budget at all, so it stays
            // out of every burn calculation rather than counting as zero.
            $table->unsignedInteger('budget_minutes')->nullable()->after('due_date');
        });
    }

    public function down(): void
    {
        Schema::table('projects', function (Blueprint $table) {
            $table->dropColumn('budget_minutes');
        });
    }
};
