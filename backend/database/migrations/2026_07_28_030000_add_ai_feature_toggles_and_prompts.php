<?php

use App\Support\AiFeatures;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('system_settings', function (Blueprint $table) {
            foreach (AiFeatures::keys() as $feature) {
                if (! Schema::hasColumn('system_settings', AiFeatures::enabledColumn($feature))) {
                    $table->boolean(AiFeatures::enabledColumn($feature))->default(true);
                }
                if (! Schema::hasColumn('system_settings', AiFeatures::promptColumn($feature))) {
                    // Blank keeps the built-in prompt, so upgrades change nothing.
                    $table->text(AiFeatures::promptColumn($feature))->nullable();
                }
            }
        });
    }

    public function down(): void
    {
        Schema::table('system_settings', function (Blueprint $table) {
            $columns = [];
            foreach (AiFeatures::keys() as $feature) {
                foreach ([AiFeatures::enabledColumn($feature), AiFeatures::promptColumn($feature)] as $column) {
                    if (Schema::hasColumn('system_settings', $column)) {
                        $columns[] = $column;
                    }
                }
            }
            if ($columns !== []) {
                $table->dropColumn($columns);
            }
        });
    }
};
