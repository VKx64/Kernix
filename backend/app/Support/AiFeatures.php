<?php

namespace App\Support;

use App\Models\SystemSetting;

/**
 * Every AI capability is switchable and its system prompt is editable from
 * Settings. A blank stored prompt means "use the built-in one", so an operator
 * can always get back to shipped behaviour by clearing the box.
 */
final class AiFeatures
{
    public const TASK_CREATION = 'task_creation';

    public const ESTIMATE_REVIEW = 'estimate_review';

    public const PROJECT_MEMORY = 'project_memory';

    public const PROJECT_BRIEF = 'project_brief';

    public const COMPLETION_AUDIT = 'completion_audit';

    public const OLIVER = 'oliver';

    /**
     * @var array<string, array{label: string, description: string}>
     */
    private const DEFINITIONS = [
        self::TASK_CREATION => [
            'label' => 'AI task creation',
            'description' => 'Turns a plain-language request into draft tasks for a project.',
        ],
        self::ESTIMATE_REVIEW => [
            'label' => 'AI estimate review',
            'description' => 'Reviews requests for more time on a task and approves, challenges, or rejects them.',
        ],
        self::PROJECT_MEMORY => [
            'label' => 'AI project memory',
            'description' => 'Reads completed tasks and proposes lessons for the project memory.',
        ],
        self::PROJECT_BRIEF => [
            'label' => 'AI project brief',
            'description' => 'Drafts a project brief from the project memory on request.',
        ],
        self::COMPLETION_AUDIT => [
            'label' => 'AI completion audit',
            'description' => 'Checks submitted proof of completion against the task before it closes.',
        ],
        self::OLIVER => [
            'label' => 'Oliver, the AI project manager',
            'description' => 'Chats in Messages and can create, update, assign, and comment on tasks under the asker’s own permissions.',
        ],
    ];

    /**
     * @return array<int, string>
     */
    public static function keys(): array
    {
        return array_keys(self::DEFINITIONS);
    }

    public static function enabledColumn(string $feature): string
    {
        return 'ai_'.$feature.'_enabled';
    }

    public static function promptColumn(string $feature): string
    {
        return 'ai_'.$feature.'_prompt';
    }

    public static function enabled(SystemSetting $settings, string $feature): bool
    {
        return (bool) ($settings->{self::enabledColumn($feature)} ?? true);
    }

    public static function prompt(SystemSetting $settings, string $feature, string $default): string
    {
        $custom = trim((string) ($settings->{self::promptColumn($feature)} ?? ''));

        return $custom === '' ? $default : $custom;
    }

    /**
     * Feature metadata plus the built-in prompt, so the settings screen can
     * show what "blank" falls back to.
     *
     * @param  array<string, string>  $defaultPrompts
     * @return array<int, array<string, mixed>>
     */
    public static function catalog(SystemSetting $settings, array $defaultPrompts): array
    {
        $catalog = [];
        foreach (self::DEFINITIONS as $key => $definition) {
            $catalog[] = [
                'key' => $key,
                'label' => $definition['label'],
                'description' => $definition['description'],
                'enabled' => self::enabled($settings, $key),
                'prompt' => (string) ($settings->{self::promptColumn($key)} ?? ''),
                'default_prompt' => $defaultPrompts[$key] ?? '',
                'enabled_field' => self::enabledColumn($key),
                'prompt_field' => self::promptColumn($key),
            ];
        }

        return $catalog;
    }
}
