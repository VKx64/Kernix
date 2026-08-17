<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Nothing recorded when a task was finished. The status said "complete"
     * and `updated_at` moved for any edit at all, so "what did I get done on
     * Tuesday" had no answer — which is why the timesheet could only ever show
     * work somebody had run a timer against.
     *
     * Backfilled from the audit trail, which does say when a task moved into a
     * finished status. Where the trail has nothing to say — a task completed
     * before auditing covered it, or one whose log has aged out — `updated_at`
     * stands in as the closest evidence available. Additive throughout: a new
     * column, and no existing column is read back out or altered.
     */
    public function up(): void
    {
        Schema::table('tasks', function (Blueprint $table) {
            $table->timestamp('completed_at')->nullable()->after('actual_minutes');
            $table->index('completed_at');
        });

        $doneIds = $this->doneStatusIds();
        if ($doneIds === []) {
            return;
        }

        DB::table('tasks')
            ->whereIn('status_value_id', $doneIds)
            ->orderBy('id')
            ->select('id', 'updated_at')
            ->chunk(500, function ($tasks) use ($doneIds) {
                foreach ($tasks as $task) {
                    DB::table('tasks')
                        ->where('id', $task->id)
                        ->update(['completed_at' => $this->finishedAt($task, $doneIds)]);
                }
            });
    }

    public function down(): void
    {
        Schema::table('tasks', function (Blueprint $table) {
            $table->dropIndex(['completed_at']);
            $table->dropColumn('completed_at');
        });
    }

    /** @return array<int, int> */
    private function doneStatusIds(): array
    {
        if (! Schema::hasTable('field_values')) {
            return [];
        }

        return DB::table('field_values')
            ->where('field_id', 3)
            ->where('key_name', 'complete')
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    /** @param  array<int, int>  $doneIds */
    private function finishedAt(object $task, array $doneIds): ?string
    {
        if (Schema::hasTable('audit_logs')) {
            $logs = DB::table('audit_logs')
                ->where('entity_id', $task->id)
                ->where('action', 'like', 'task.%')
                ->orderByDesc('id')
                ->limit(50)
                ->pluck('changes_json', 'created_at');

            foreach ($logs as $createdAt => $changes) {
                $decoded = json_decode((string) $changes, true);
                $after = $decoded['after']['status_value_id'] ?? $decoded['status_value_id'] ?? null;
                if ($after !== null && in_array((int) $after, $doneIds, true)) {
                    return (string) $createdAt;
                }
            }
        }

        return $task->updated_at === null ? null : (string) $task->updated_at;
    }
};
