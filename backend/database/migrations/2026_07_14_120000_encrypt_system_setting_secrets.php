<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private const SECRET_COLUMNS = [
        'smtp_password',
        's3_access_key',
        's3_secret_key',
    ];

    public function up(): void
    {
        Schema::table('system_settings', function (Blueprint $table): void {
            foreach (self::SECRET_COLUMNS as $column) {
                $table->text($column)->nullable()->change();
            }
        });

        foreach (DB::table('system_settings')->get() as $settings) {
            $encrypted = [];
            foreach (self::SECRET_COLUMNS as $column) {
                $value = $settings->{$column};
                $encrypted[$column] = filled($value)
                    ? Crypt::encryptString((string) $value)
                    : null;
            }
            DB::table('system_settings')->where('id', $settings->id)->update($encrypted);
        }
    }

    public function down(): void
    {
        foreach (DB::table('system_settings')->get() as $settings) {
            $decrypted = [];
            foreach (self::SECRET_COLUMNS as $column) {
                $value = $settings->{$column};
                $decrypted[$column] = filled($value)
                    ? Crypt::decryptString((string) $value)
                    : null;
            }
            DB::table('system_settings')->where('id', $settings->id)->update($decrypted);
        }

        Schema::table('system_settings', function (Blueprint $table): void {
            foreach (self::SECRET_COLUMNS as $column) {
                $table->string($column, 500)->nullable()->change();
            }
        });
    }
};
