<?php

namespace App\Support;

use App\Models\Client;
use App\Models\Contact;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskNote;
use App\Models\Workspace;

/**
 * What is still using a feature, so disabling it can be blocked or confirmed
 * instead of silently orphaning data. Every count runs inside the *target*
 * workspace, not the caller's own active one — `CurrentWorkspace::use` at the
 * call boundary is what makes that true, since the workspace-scoped models
 * this reads all filter by whichever workspace is current.
 */
final class WorkspaceFeatureBlockers
{
    /**
     * @return array<int, array{type: string, count: int, label: string}>
     */
    public static function for(Workspace $workspace, string $feature): array
    {
        return match ($feature) {
            WorkspaceFeatures::MESSAGES => self::messageThreads($workspace),
            WorkspaceFeatures::CLIENTS => self::clientData($workspace),
            WorkspaceFeatures::PROJECTS => self::projectData($workspace),
            default => [],
        };
    }

    /**
     * Other features that require the one being turned off, and are
     * currently on. The caller surfaces this so an admin knows disabling
     * clients also silently turns contacts off.
     *
     * @return array<int, string>
     */
    public static function dependentFeatures(Workspace $workspace, string $feature): array
    {
        $dependents = [];
        foreach (WorkspaceFeatures::keys() as $key) {
            if ($key !== $feature && in_array($feature, WorkspaceFeatures::requires($key), true) && WorkspaceFeatures::enabled($workspace, $key)) {
                $dependents[] = $key;
            }
        }

        return $dependents;
    }

    /**
     * @return array<int, array{type: string, count: int, label: string}>
     */
    private static function messageThreads(Workspace $workspace): array
    {
        $count = CurrentWorkspace::use($workspace->id, fn () => TaskNote::query()
            ->where('is_message', true)
            ->whereColumn('task_notes.id', 'task_notes.conversation_id')
            ->whereHas('task', fn ($query) => $query->whereNull('archived_at'))
            ->count());

        if ($count === 0) {
            return [];
        }

        return [[
            'type' => 'message_threads',
            'count' => $count,
            'label' => $count === 1 ? '1 active message thread' : "{$count} active message threads",
        ]];
    }

    /**
     * @return array<int, array{type: string, count: int, label: string}>
     */
    private static function clientData(Workspace $workspace): array
    {
        return CurrentWorkspace::use($workspace->id, function () {
            $blockers = [];
            $clients = Client::query()->where('is_default', false)->whereNull('archived_at')->count();
            if ($clients > 0) {
                $blockers[] = [
                    'type' => 'clients',
                    'count' => $clients,
                    'label' => $clients === 1 ? '1 active client' : "{$clients} active clients",
                ];
            }
            $contacts = Contact::query()->whereNull('archived_at')->count();
            if ($contacts > 0) {
                $blockers[] = [
                    'type' => 'contacts',
                    'count' => $contacts,
                    'label' => $contacts === 1 ? '1 active contact' : "{$contacts} active contacts",
                ];
            }

            return $blockers;
        });
    }

    /**
     * @return array<int, array{type: string, count: int, label: string}>
     */
    private static function projectData(Workspace $workspace): array
    {
        return CurrentWorkspace::use($workspace->id, function () {
            $blockers = [];
            $projects = Project::query()->where('is_default', false)->whereNull('archived_at')->count();
            if ($projects > 0) {
                $blockers[] = [
                    'type' => 'projects',
                    'count' => $projects,
                    'label' => $projects === 1 ? '1 active project' : "{$projects} active projects",
                ];
            }
            $tasks = Task::query()
                ->whereNull('archived_at')
                ->whereHas('project', fn ($project) => $project->where('is_default', false))
                ->count();
            if ($tasks > 0) {
                $blockers[] = [
                    'type' => 'tasks',
                    'count' => $tasks,
                    'label' => $tasks === 1 ? '1 active task' : "{$tasks} active tasks",
                ];
            }

            return $blockers;
        });
    }
}
