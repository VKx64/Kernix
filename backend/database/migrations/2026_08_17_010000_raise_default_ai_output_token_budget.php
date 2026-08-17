<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * 1,200 output tokens is not enough for the AI features that emit a list.
 *
 * Reasoning tokens are spent from the same budget, so a thinking model can burn
 * the whole allowance before writing a visible character: task generation came
 * back with `finish_reason: length`, zero content, and a "the model replied in
 * prose" error that pointed nowhere near the real cause.
 *
 * Only rows still sitting on the old default are moved. Anyone who deliberately
 * chose a number keeps it — this is correcting a default nobody picked, not
 * overriding a decision somebody made.
 */
return new class extends Migration
{
    private const OLD_DEFAULT = 1200;

    private const NEW_DEFAULT = 4000;

    public function up(): void
    {
        DB::table('system_settings')
            ->where('ai_max_output_tokens', self::OLD_DEFAULT)
            ->update(['ai_max_output_tokens' => self::NEW_DEFAULT]);
    }

    public function down(): void
    {
        DB::table('system_settings')
            ->where('ai_max_output_tokens', self::NEW_DEFAULT)
            ->update(['ai_max_output_tokens' => self::OLD_DEFAULT]);
    }
};
