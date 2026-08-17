<?php

namespace App\Support;

use App\Models\Workspace;

/**
 * Per-workspace switches for entire product surfaces. Every key the workspace
 * can eventually gate lives in DEFINITIONS so the column, the cast, and the
 * enforcement (middleware, blockers, the toggle write endpoint) are all one
 * registry. RENDERED is a narrower list still: only those keys show up as a
 * switch on the workspace settings screen. A key can be fully enforced —
 * middleware, provisioning, blockers — before it is rendered there, which is
 * how clients/projects ship enforcement ahead of the switch that flips them.
 */
final class WorkspaceFeatures
{
    public const CONTACTS = 'contacts';

    public const CLIENTS = 'clients';

    public const PROJECTS = 'projects';

    public const OLIVER = 'oliver';

    public const TIMESHEET = 'timesheet';

    public const MESSAGES = 'messages';

    public const WHATSAPP = 'whatsapp';

    /**
     * @var array<string, array{label: string, description: string, requires: array<int, string>}>
     */
    private const DEFINITIONS = [
        self::CONTACTS => [
            'label' => 'Contacts',
            'description' => 'The contacts directory and its archive.',
            'requires' => [self::CLIENTS],
        ],
        self::CLIENTS => [
            'label' => 'Clients',
            'description' => 'The client list and client records.',
            'requires' => [],
        ],
        self::PROJECTS => [
            'label' => 'Projects',
            'description' => 'The project list and project records.',
            'requires' => [],
        ],
        self::OLIVER => [
            'label' => 'Oliver',
            'description' => 'The AI project manager: chat, insights, and the actions it takes on tasks.',
            'requires' => [],
        ],
        self::TIMESHEET => [
            'label' => 'Timesheet',
            'description' => 'The timesheet report. Clock in and clock out keep working regardless of this switch.',
            'requires' => [],
        ],
        self::MESSAGES => [
            'label' => 'Messages',
            'description' => 'The messages inbox, plus the work-request and estimate-request workflows that deliver through it.',
            'requires' => [],
        ],
        self::WHATSAPP => [
            'label' => 'WhatsApp',
            'description' => 'Sends notifications to linked WhatsApp numbers and acts on replies. Off until a workspace links an account.',
            'requires' => [self::MESSAGES],
        ],
    ];

    /** Keys shown as a switch on the workspace settings screen. */
    private const RENDERED = [self::CONTACTS, self::TIMESHEET, self::MESSAGES, self::WHATSAPP, self::OLIVER, self::CLIENTS, self::PROJECTS];

    /**
     * @return array<int, string>
     */
    public static function keys(): array
    {
        return array_keys(self::DEFINITIONS);
    }

    /**
     * @return array<int, string>
     */
    public static function renderedKeys(): array
    {
        return self::RENDERED;
    }

    public static function enabledColumn(string $feature): string
    {
        return 'feature_'.$feature.'_enabled';
    }

    public static function enabled(Workspace $workspace, string $feature): bool
    {
        return (bool) ($workspace->{self::enabledColumn($feature)} ?? true);
    }

    public static function label(string $feature): string
    {
        return self::DEFINITIONS[$feature]['label'] ?? $feature;
    }

    /**
     * @return array<int, string>
     */
    public static function requires(string $feature): array
    {
        return self::DEFINITIONS[$feature]['requires'] ?? [];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public static function catalog(Workspace $workspace): array
    {
        $catalog = [];
        foreach (self::RENDERED as $key) {
            $definition = self::DEFINITIONS[$key];
            $catalog[] = [
                'key' => $key,
                'label' => $definition['label'],
                'description' => $definition['description'],
                'enabled' => self::enabled($workspace, $key),
                'requires' => $definition['requires'],
            ];
        }

        return $catalog;
    }
}
