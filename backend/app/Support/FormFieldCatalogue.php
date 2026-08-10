<?php

namespace App\Support;

/**
 * The eight field types a project intake form can offer, styled after
 * WorkspaceFeatures/PermissionCatalog: one registry the builder, the
 * validator, and the converter all read from instead of re-declaring the
 * same list. Nothing here is queried per-field — a form's `fields` column is
 * a JSON blob rewritten wholesale, so this class only ever validates and
 * describes shapes, it never persists one.
 */
final class FormFieldCatalogue
{
    public const SHORT_TEXT = 'short_text';

    public const LONG_TEXT = 'long_text';

    public const STEPS = 'steps';

    public const SEVERITY = 'severity';

    public const SELECT = 'select';

    public const EMAIL = 'email';

    public const DATE = 'date';

    public const FILE = 'file';

    public const MAP_TITLE = 'title';

    public const MAP_DESCRIPTION = 'description';

    public const MAP_SUBTASKS = 'subtasks';

    public const MAP_URGENCY = 'urgency';

    public const MAP_DUE = 'due';

    public const MAP_NONE = 'none';

    public const MAX_FIELDS = 12;

    /** Answer length caps enforced against every public submission. */
    public const MAX_SHORT_TEXT = 120;

    public const MAX_LONG_TEXT = 4000;

    public const MAX_STEPS_LINES = 20;

    public const MAX_STEP_LINE = 200;

    public const MAX_EMAIL = 190;

    /**
     * @var array<string, array{label: string, hasChoices: bool, allowedMaps: array<int, string>}>
     */
    private const TYPES = [
        self::SHORT_TEXT => ['label' => 'Short text', 'hasChoices' => false, 'allowedMaps' => [self::MAP_TITLE, self::MAP_NONE]],
        self::LONG_TEXT => ['label' => 'Long text', 'hasChoices' => false, 'allowedMaps' => [self::MAP_DESCRIPTION, self::MAP_NONE]],
        self::STEPS => ['label' => 'Steps', 'hasChoices' => false, 'allowedMaps' => [self::MAP_SUBTASKS, self::MAP_NONE]],
        self::SEVERITY => ['label' => 'Severity', 'hasChoices' => true, 'allowedMaps' => [self::MAP_URGENCY, self::MAP_NONE]],
        self::SELECT => ['label' => 'Select', 'hasChoices' => true, 'allowedMaps' => [self::MAP_NONE]],
        self::EMAIL => ['label' => 'Email', 'hasChoices' => false, 'allowedMaps' => [self::MAP_NONE]],
        self::DATE => ['label' => 'Date', 'hasChoices' => false, 'allowedMaps' => [self::MAP_DUE, self::MAP_NONE]],
        self::FILE => ['label' => 'File', 'hasChoices' => false, 'allowedMaps' => [self::MAP_NONE]],
    ];

    /** @return array<int, string> */
    public static function types(): array
    {
        return array_keys(self::TYPES);
    }

    public static function isValidType(string $type): bool
    {
        return array_key_exists($type, self::TYPES);
    }

    public static function label(string $type): string
    {
        return self::TYPES[$type]['label'] ?? $type;
    }

    public static function hasChoices(string $type): bool
    {
        return self::TYPES[$type]['hasChoices'] ?? false;
    }

    /** @return array<int, string> */
    public static function allowedMaps(string $type): array
    {
        return self::TYPES[$type]['allowedMaps'] ?? [self::MAP_NONE];
    }

    public static function isMapAllowed(string $type, ?string $map): bool
    {
        $map = $map ?: self::MAP_NONE;

        return in_array($map, self::allowedMaps($type), true);
    }

    /** @return array<int, string> map targets that must be claimed by at most one field */
    public static function exclusiveMaps(): array
    {
        return [self::MAP_TITLE, self::MAP_DESCRIPTION, self::MAP_SUBTASKS, self::MAP_URGENCY, self::MAP_DUE];
    }
}
