<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('user_settings')) {
            return;
        }

        Schema::create('user_settings', function (Blueprint $table) {
            $table->increments('id');
            // One row per person, written the first time they change anything.
            // Everyone else is served the defaults, so an absent row is normal.
            $table->unsignedInteger('user_id')->unique();
            // A bag rather than a column each: these are employee preferences
            // that come and go with the UI, not schema anybody queries across.
            $table->json('values');
            $table->timestamps();
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_settings');
    }
};
