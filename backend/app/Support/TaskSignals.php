<?php

namespace App\Support;

use App\Models\FieldValue;

/**
 * The single source of truth for what a task_status slug *means*. The
 * workspace's status vocabulary is configurable, so grouping keys on a
 * semantic role rather than a slug; an unrecognized custom slug still gets a
 * sensible role instead of vanishing from role-based views.
 */
final class TaskSignals
{
    /** @var array<string, string> */
    public const STATUS_ROLES = [
        'planning' => 'open',
        'pending' => 'open',
        'in_progress' => 'active',
        'quality_check' => 'review',
        'blocked' => 'blocked',
        'needs_correction' => 'blocked',
        'complete' => 'done',
    ];

    /** @var array<string, int> */
    public const URGENCY_RANKS = [
        'urgent' => 0,
        'high' => 1,
        'normal' => 2,
        'low' => 3,
    ];

    /** @var array<string, array<int, int>>|null */
    private static ?array $roleIdCache = null;

    public static function statusRole(?string $slug): string
    {
        return self::STATUS_ROLES[$slug] ?? 'open';
    }

    public static function urgencyRank(?string $slug): int
    {
        return self::URGENCY_RANKS[$slug] ?? 2;
    }

    /**
     * Resolve roles to the `field_values.id` list for the task_status field,
     * so query scopes can use `whereIn`. Cached per request.
     *
     * @param  array<int, string>  $roles
     * @return array<int, int>
     */
    public static function statusValueIdsForRoles(array $roles): array
    {
        if (self::$roleIdCache === null) {
            self::$roleIdCache = [];
            $values = FieldValue::query()
                ->where('field_id', 3)
                ->get(['id', 'key_name']);
            foreach ($values as $value) {
                $role = self::statusRole($value->key_name);
                self::$roleIdCache[$role][] = (int) $value->id;
            }
        }

        $ids = [];
        foreach ($roles as $role) {
            $ids = array_merge($ids, self::$roleIdCache[$role] ?? []);
        }

        return array_values(array_unique($ids));
    }

    public static function flush(): void
    {
        self::$roleIdCache = null;
    }
}
