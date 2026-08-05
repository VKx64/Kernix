<?php

use App\Support\AiFeatures;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Features registered after the first toggle migration ran still need their
     * columns on databases that are already live. Idempotent by design, so it
     * also covers whatever gets registered next.
     */
    public function up(): void
    {
        Schema::table('system_settings', function (Blueprint $table) {
            foreach (AiFeatures::keys() as $feature) {
                if (! Schema::hasColumn('system_settings', AiFeatures::enabledColumn($feature))) {
                    $table->boolean(AiFeatures::enabledColumn($feature))->default(true);
                }
                if (! Schema::hasColumn('system_settings', AiFeatures::promptColumn($feature))) {
                    $table->text(AiFeatures::promptColumn($feature))->nullable();
                }
            }
        });
    }

    public function down(): void
    {
        // The columns are dropped by the migration that introduced the feature set.
    }
};
