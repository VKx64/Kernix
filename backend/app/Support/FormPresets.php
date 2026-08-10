<?php

namespace App\Support;

use App\Models\Project;
use App\Models\ProjectForm;
use App\Models\User;
use Illuminate\Support\Str;

/**
 * Bug Report and Feature Request: the two forms a project can get in one
 * click with no wizard. Each preset is a complete, LIVE, working form the
 * moment it is created — the admin can still edit every field afterward.
 */
final class FormPresets
{
    public const BUG_REPORT = 'bug_report';

    public const FEATURE_REQUEST = 'feature_request';

    /** @return array<int, string> */
    public static function keys(): array
    {
        return [self::BUG_REPORT, self::FEATURE_REQUEST];
    }

    public static function create(Project $project, User $creator, string $preset): ProjectForm
    {
        $definition = match ($preset) {
            self::BUG_REPORT => self::bugReport(),
            self::FEATURE_REQUEST => self::featureRequest(),
            default => abort(422, 'Unknown form preset.'),
        };

        $fields = $definition['fields'];
        foreach ($fields as $index => $field) {
            $fields[$index]['id'] = 'fl'.($index + 1);
        }

        return ProjectForm::query()->create([
            'project_id' => $project->id,
            'title' => $definition['title'],
            'blurb' => $definition['blurb'],
            'header_line' => $project->client?->name,
            'icon' => $definition['icon'],
            'slug' => self::uniqueSlug(),
            'state' => 'live',
            'fields' => $fields,
            'next_field_seq' => count($fields) + 1,
            'require_email' => true,
            'auto_convert' => false,
            'notify' => true,
            'task_type_key' => null,
            'created_by' => $creator->id,
        ]);
    }

    public static function uniqueSlug(): string
    {
        do {
            $slug = Str::random(32);
        } while (ProjectForm::acrossWorkspaces()->where('slug', $slug)->exists());

        return $slug;
    }

    /** @return array{title: string, blurb: string, icon: string, fields: array<int, array<string, mixed>>} */
    private static function bugReport(): array
    {
        return [
            'title' => 'Bug Report',
            'blurb' => "Something in the portal is broken. Tell us what happened and we'll pick it up.",
            'icon' => 'bug',
            'fields' => [
                [
                    'type' => FormFieldCatalogue::SHORT_TEXT, 'label' => 'What went wrong?',
                    'help' => 'One line we can use as the task title', 'required' => true,
                    'choices' => [], 'maps' => FormFieldCatalogue::MAP_TITLE, 'min' => null, 'max' => null,
                ],
                [
                    'type' => FormFieldCatalogue::SEVERITY, 'label' => 'How bad is it?',
                    'help' => 'Blocking · Painful · Minor', 'required' => true,
                    'choices' => [
                        ['value' => 'blocking', 'label' => 'Blocking', 'caption' => null, 'urgency_key' => 'urgent'],
                        ['value' => 'painful', 'label' => 'Painful', 'caption' => null, 'urgency_key' => 'high'],
                        ['value' => 'minor', 'label' => 'Minor', 'caption' => null, 'urgency_key' => 'low'],
                    ],
                    'maps' => FormFieldCatalogue::MAP_URGENCY, 'min' => null, 'max' => null,
                ],
                [
                    'type' => FormFieldCatalogue::STEPS, 'label' => 'Steps to reproduce',
                    'help' => 'Becomes the task checklist, one step per line', 'required' => false,
                    'choices' => [], 'maps' => FormFieldCatalogue::MAP_SUBTASKS, 'min' => null, 'max' => null,
                ],
                [
                    'type' => FormFieldCatalogue::LONG_TEXT, 'label' => 'Anything else we should know?',
                    'help' => null, 'required' => false,
                    'choices' => [], 'maps' => FormFieldCatalogue::MAP_DESCRIPTION, 'min' => null, 'max' => null,
                ],
                [
                    'type' => FormFieldCatalogue::FILE, 'label' => 'Screenshot or recording',
                    'help' => 'Up to 3 files, 10 MB each', 'required' => false,
                    'choices' => [], 'maps' => FormFieldCatalogue::MAP_NONE, 'min' => null, 'max' => 3,
                ],
            ],
        ];
    }

    /** @return array{title: string, blurb: string, icon: string, fields: array<int, array<string, mixed>>} */
    private static function featureRequest(): array
    {
        return [
            'title' => 'Feature Request',
            'blurb' => 'Ask for something new. Tell us the outcome you want and why it matters.',
            'icon' => 'spark',
            'fields' => [
                [
                    'type' => FormFieldCatalogue::SHORT_TEXT, 'label' => 'What would you like?',
                    'help' => 'One line we can use as the task title', 'required' => true,
                    'choices' => [], 'maps' => FormFieldCatalogue::MAP_TITLE, 'min' => null, 'max' => null,
                ],
                [
                    'type' => FormFieldCatalogue::LONG_TEXT, 'label' => 'What outcome are you after?',
                    'help' => null, 'required' => true,
                    'choices' => [], 'maps' => FormFieldCatalogue::MAP_DESCRIPTION, 'min' => null, 'max' => null,
                ],
                [
                    'type' => FormFieldCatalogue::LONG_TEXT, 'label' => 'What is the business case?',
                    'help' => 'Why this matters, and what happens without it', 'required' => true,
                    'choices' => [], 'maps' => FormFieldCatalogue::MAP_NONE, 'min' => null, 'max' => null,
                ],
                [
                    'type' => FormFieldCatalogue::SELECT, 'label' => 'How soon do you need this?',
                    'help' => null, 'required' => false,
                    'choices' => [
                        ['value' => 'this_quarter', 'label' => 'This quarter', 'caption' => null, 'urgency_key' => null],
                        ['value' => 'this_year', 'label' => 'This year', 'caption' => null, 'urgency_key' => null],
                        ['value' => 'someday', 'label' => 'Someday', 'caption' => null, 'urgency_key' => null],
                    ],
                    'maps' => FormFieldCatalogue::MAP_NONE, 'min' => null, 'max' => null,
                ],
                [
                    'type' => FormFieldCatalogue::DATE, 'label' => 'Deadline, if there is one',
                    'help' => null, 'required' => false,
                    'choices' => [], 'maps' => FormFieldCatalogue::MAP_DUE, 'min' => null, 'max' => null,
                ],
            ],
        ];
    }
}
