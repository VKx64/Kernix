<?php

use App\Support\WorkspaceFeatures;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('workspaces', function (Blueprint $table) {
            foreach (WorkspaceFeatures::keys() as $feature) {
                $column = WorkspaceFeatures::enabledColumn($feature);
                if (! Schema::hasColumn('workspaces', $column)) {
                    // default(true): every existing and newly-provisioned
                    // workspace starts all-on, so nothing needs a backfill.
                    $table->boolean($column)->default(true)->nullable(false);
                }
            }
        });
    }

    public function down(): void
    {
        Schema::table('workspaces', function (Blueprint $table) {
            $columns = array_values(array_filter(
                array_map(fn (string $feature) => WorkspaceFeatures::enabledColumn($feature), WorkspaceFeatures::keys()),
                fn (string $column) => Schema::hasColumn('workspaces', $column)
            ));
            if ($columns !== []) {
                $table->dropColumn($columns);
            }
        });
    }
};
