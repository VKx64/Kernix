<?php

namespace App\Support;

use App\Models\ProjectForm;
use App\Models\SystemSetting;
use Carbon\Carbon;

/**
 * Whether a public form is currently open, computed once per request by
 * ResolvePublicForm so the GET preview and the POST submission agree on
 * exactly the same answer. Every distinct reason a form is unreachable —
 * paused, past its closing date, an archived or deleted project, an
 * archived client, the workspace's `projects` feature switched off —
 * collapses to the SAME message. A stranger probing a slug must not be able
 * to tell internal configuration (a feature toggle, an archived client)
 * apart from an ordinary pause.
 *
 * closes_on has no per-workspace timezone column to read: the app has only
 * the single global `system_settings.default_timezone` that
 * ApplyWorkspaceTimezone already applies everywhere else, so that global
 * setting stands in for "the workspace's timezone" here too.
 */
final class PublicFormAvailability
{
    public const MESSAGE = 'This form is not accepting submissions right now.';

    /**
     * @param  ProjectForm  $form  must already have `project.client` and `workspace` loaded
     */
    public static function closedReason(ProjectForm $form): ?string
    {
        $workspace = $form->workspace;
        if (! $workspace || ! WorkspaceFeatures::enabled($workspace, WorkspaceFeatures::PROJECTS)) {
            return self::MESSAGE;
        }

        if ($form->state !== 'live') {
            return self::MESSAGE;
        }

        if ($form->closes_on && self::pastClose($form->closes_on)) {
            return self::MESSAGE;
        }

        // A soft-deleted project or client never loads through the relation
        // at all (its own SoftDeletes scope hides it), so a missing relation
        // and an explicitly archived one are the same closed state.
        $project = $form->project;
        if (! $project || $project->archived_at) {
            return self::MESSAGE;
        }

        $client = $project->client;
        if (! $client || $client->archived_at) {
            return self::MESSAGE;
        }

        return null;
    }

    private static function pastClose(Carbon $closesOn): bool
    {
        $timezone = SystemSetting::query()->value('default_timezone') ?: config('app.timezone');
        $timezone = in_array($timezone, timezone_identifiers_list(), true) ? $timezone : 'UTC';
        $endOfDay = Carbon::parse($closesOn->toDateString(), $timezone)->endOfDay();

        return now($timezone)->greaterThan($endOfDay);
    }
}
