<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('form_submission_files', 'field_id')) {
            Schema::table('form_submission_files', function (Blueprint $table) {
                // Which "file" field on the form this upload was posted
                // under, e.g. "fl3". Nullable: rows created before this
                // column existed, and anything stored outside the public
                // submission flow, have none.
                $table->string('field_id', 16)->nullable()->after('form_submission_id');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('form_submission_files', 'field_id')) {
            Schema::table('form_submission_files', function (Blueprint $table) {
                $table->dropColumn('field_id');
            });
        }
    }
};
