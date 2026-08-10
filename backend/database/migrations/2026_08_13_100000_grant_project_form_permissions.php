<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Forms is a project surface: whoever can already see a project's tasks
     * inherits the ability to see its intake queue, editing follows project
     * editing, and reviewing (converting/declining) follows the ability to
     * both see projects and create tasks.
     */
    public function up(): void
    {
        $this->grant('projects.view', 'forms.view');
        $this->grant('projects.edit', 'forms.manage');

        $reviewers = DB::table('role_permissions')->where('permission_key', 'projects.view')->pluck('role_id')
            ->intersect(DB::table('role_permissions')->where('permission_key', 'tasks.create')->pluck('role_id'));
        $grants = $reviewers->map(fn ($roleId) => ['role_id' => $roleId, 'permission_key' => 'forms.review'])->all();
        if ($grants !== []) {
            DB::table('role_permissions')->insertOrIgnore($grants);
        }
    }

    public function down(): void
    {
        DB::table('role_permissions')->whereIn('permission_key', ['forms.view', 'forms.manage', 'forms.review'])->delete();
    }

    private function grant(string $from, string $to): void
    {
        $roleIds = DB::table('role_permissions')->where('permission_key', $from)->distinct()->pluck('role_id');
        $grants = $roleIds->map(fn ($roleId) => ['role_id' => $roleId, 'permission_key' => $to])->all();
        if ($grants !== []) {
            DB::table('role_permissions')->insertOrIgnore($grants);
        }
    }
};
