<?php

namespace App\Support;

use App\Models\FieldValue;

/**
 * Task status ids are seeded data, so they are looked up by key rather than
 * hardcoded. Reads are memoized per request.
 */
final class TaskStatuses
{
    public const COMPLETE = 'complete';

    public const QUALITY_CHECK = 'quality_check';

    public const NEEDS_CORRECTION = 'needs_correction';

    /** @var array<string, int|null> */
    private static array $cache = [];

    public static function id(string $key): ?int
    {
        if (! array_key_exists($key, self::$cache)) {
            $id = FieldValue::query()
                ->where('key_name', $key)
                ->whereHas('field', fn ($query) => $query->where('key_name', 'task_status'))
                ->value('id');
            self::$cache[$key] = $id === null ? null : (int) $id;
        }

        return self::$cache[$key];
    }

    public static function is(mixed $statusValueId, string $key): bool
    {
        $id = self::id($key);

        return $id !== null && (int) $statusValueId === $id;
    }

    public static function flush(): void
    {
        self::$cache = [];
    }
}
