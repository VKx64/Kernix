<?php

namespace App\Support;

use App\Models\User;
use App\Models\UserSetting;
use Illuminate\Validation\Rule;

/**
 * Every employee preference the app knows about, with its default and the shape
 * it is allowed to take. The defaults and the coercion live together on purpose:
 * a caller asking for someone's settings gets a complete, in-range set whether
 * that person has ever opened the settings screen or not, and a value that has
 * gone stale in the database falls back rather than reaching a screen.
 *
 * Only the first eight of these drive server or client behaviour today. The rest
 * are stored so a toggle remembers itself; nothing acts on them yet.
 */
class UserSettings
{
    /** @var array<string, array<string, mixed>> */
    private const SCHEMA = [
        'daily_target_minutes' => ['type' => 'int', 'default' => 420, 'min' => 60, 'max' => 720],
        'weekly_target_minutes' => ['type' => 'int', 'default' => 2100, 'min' => 300, 'max' => 3600],
        'timesheet_cutoff' => ['type' => 'enum', 'default' => 'semi', 'options' => ['semi', 'month']],
        'timesheet_date_format' => ['type' => 'enum', 'default' => 'short', 'options' => ['short', 'pad', 'mon']],
        'timesheet_header_row' => ['type' => 'bool', 'default' => false],
        'row_density' => ['type' => 'enum', 'default' => 'comfortable', 'options' => ['comfortable', 'compact']],
        'auto_start_timer' => ['type' => 'bool', 'default' => false],
        'start_page' => ['type' => 'enum', 'default' => 'dashboard', 'options' => ['dashboard', 'tasks', 'oliver']],
        'notify_in_app' => ['type' => 'bool', 'default' => true],
        'notify_email' => ['type' => 'bool', 'default' => false],
        'notify_assigned' => ['type' => 'bool', 'default' => true],
        'notify_mentions' => ['type' => 'bool', 'default' => true],
        'notify_due' => ['type' => 'bool', 'default' => true],
        'notify_oliver' => ['type' => 'bool', 'default' => true],
        'daily_digest' => ['type' => 'enum', 'default' => 'off', 'options' => ['off', 'am', 'pm']],
        'break_reminders' => ['type' => 'bool', 'default' => false],
        'idle_detection' => ['type' => 'bool', 'default' => false],
    ];

    /** @return array<int, string> */
    public static function keys(): array
    {
        return array_keys(self::SCHEMA);
    }

    /** @return array<string, mixed> */
    public static function defaults(): array
    {
        return self::coerce([]);
    }

    /**
     * The complete, in-range set for one person.
     *
     * @return array<string, mixed>
     */
    public static function for(User $user): array
    {
        $stored = UserSetting::query()->where('user_id', $user->id)->first()?->values;

        return self::coerce(is_array($stored) ? $stored : []);
    }

    /**
     * Fill the gaps and drag anything out of range back inside it. A number
     * clamps, because "6 hours is the shortest day we allow" is a better answer
     * than an error; anything unreadable falls back to the default.
     *
     * @param  array<string, mixed>  $values
     * @return array<string, mixed>
     */
    public static function coerce(array $values): array
    {
        $coerced = [];
        foreach (self::SCHEMA as $key => $spec) {
            $coerced[$key] = array_key_exists($key, $values)
                ? self::value($values[$key], $spec)
                : $spec['default'];
        }

        return $coerced;
    }

    /**
     * Validation for a partial write. Numbers are only checked for being
     * numbers here; the range is handled by the clamp above.
     *
     * @return array<string, array<int, mixed>>
     */
    public static function rules(): array
    {
        $rules = [];
        foreach (self::SCHEMA as $key => $spec) {
            $rules[$key] = match ($spec['type']) {
                'int' => ['sometimes', 'integer'],
                'bool' => ['sometimes', 'boolean'],
                'enum' => ['sometimes', Rule::in($spec['options'])],
            };
        }

        return $rules;
    }

    /** @param array<string, mixed> $spec */
    private static function value(mixed $raw, array $spec): mixed
    {
        return match ($spec['type']) {
            'int' => is_numeric($raw)
                ? max($spec['min'], min($spec['max'], (int) $raw))
                : $spec['default'],
            'bool' => filter_var($raw, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? $spec['default'],
            'enum' => in_array($raw, $spec['options'], true) ? $raw : $spec['default'],
        };
    }
}
