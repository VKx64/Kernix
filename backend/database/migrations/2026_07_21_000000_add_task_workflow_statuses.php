<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        $fieldId = DB::table('fields')->where('key_name', 'task_status')->value('id');
        if (! $fieldId) {
            return;
        }

        $now = now();
        $statuses = [
            ['planning', 'Planning', '#8b5cf6', 10],
            ['pending', 'Pending', '#64748b', 20],
            ['in_progress', 'In Progress', '#3b82f6', 30],
            ['quality_check', 'Quality Check', '#06b6d4', 40],
            ['needs_correction', 'Needs Correction', '#f97316', 50],
            ['blocked', 'Blocked', '#ef4444', 60],
            ['complete', 'Complete', '#22c55e', 70],
        ];

        foreach ($statuses as [$key, $label, $color, $sortOrder]) {
            $statusQuery = DB::table('field_values')->where('field_id', $fieldId)->where('key_name', $key);
            $values = [
                'label' => $label,
                'color' => $color,
                'status' => 'active',
                'sort_order' => $sortOrder,
                'deleted_at' => null,
                'updated_at' => $now,
            ];
            if ($statusQuery->exists()) {
                $statusQuery->update($values);
            } else {
                DB::table('field_values')->insert($values + [
                    'field_id' => $fieldId,
                    'key_name' => $key,
                    'created_at' => $now,
                ]);
            }
        }
    }

    public function down(): void
    {
        $fieldId = DB::table('fields')->where('key_name', 'task_status')->value('id');
        if (! $fieldId) {
            return;
        }

        DB::table('field_values')
            ->where('field_id', $fieldId)
            ->whereIn('key_name', ['planning', 'quality_check', 'needs_correction'])
            ->delete();
    }
};
