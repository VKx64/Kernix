<?php

namespace App\Services;

use App\Models\AuditLog;
use App\Models\Client;
use App\Models\Project;
use App\Models\Task;
use App\Models\TimeEntry;
use App\Models\User;
use App\Support\DeliveryHealth;
use App\Support\TaskSignals;
use Carbon\Carbon;
use Illuminate\Support\Collection;

/**
 * The one place a project's or a client's delivery numbers are worked out, so
 * a card in a list and the detail page behind it cannot disagree. Everything
 * here answers a whole list in a fixed number of queries: the portfolio
 * screens ask for stats on every row at once, and an N+1 there is not a
 * slowdown, it is an outage.
 *
 * Logged time is read from the reconciled `tasks.actual_minutes` total rather
 * than re-walked from `time_entries`; the retainer burn is the one number that
 * needs the entries themselves, because it is scoped to the calendar month.
 */
class PortfolioStats
{
    private const OPEN_TASKS_LIMIT = 5;

    private const ACTIVITY_LIMIT = 10;

    /**
     * Mirrors the dashboard's phrasing so the same audit row reads the same way
     * wherever it surfaces.
     *
     * @var array<string, string>
     */
    private const ACTIVITY_VERBS = [
        'task.create' => 'created',
        'task.update' => 'updated',
        'task.archive' => 'archived',
        'task.restore' => 'restored',
        'task.delete' => 'deleted',
        'task.note.create' => 'commented on',
        'task.note.update' => 'edited a comment on',
        'task.note.delete' => 'deleted a comment on',
        'task.message.start' => 'sent a message about',
        'task.message.reply' => 'replied about',
        'task.subtask.create' => 'added a subtask to',
        'task.subtask.update' => 'updated a subtask on',
        'task.subtask.complete' => 'completed a subtask on',
        'task.subtask.delete' => 'removed a subtask from',
        'task.attachment.create' => 'attached a file to',
        'task.attachment.delete' => 'removed a file from',
        'task.completion_proof.submit' => 'submitted completion proof for',
        'task.estimate_request.create' => 'requested an estimate on',
        'task.estimate_request.approve' => 'approved the estimate on',
        'task.estimate_request.reject' => 'rejected the estimate on',
        'task.estimate_request.override' => 'overrode the estimate on',
        'task.work_request.create' => 'asked to work on',
        'task.work_request.withdraw' => 'withdrew a work request on',
        'task.email.send' => 'emailed the client about',
        'task.email.delete' => 'deleted an email on',
    ];

    /**
     * @param  Collection<int, Project>  $projects
     * @return array<int, array<string, mixed>> keyed by project id
     */
    public function forProjects(Collection $projects): array
    {
        $aggregates = $this->taskAggregates($this->ids($projects));

        $stats = [];
        foreach ($projects as $project) {
            $row = $aggregates[(int) $project->id] ?? [];
            $total = (int) ($row['total'] ?? 0);
            $done = (int) ($row['done'] ?? 0);
            $open = $total - $done;
            $overdue = (int) ($row['overdue'] ?? 0);
            $blocked = (int) ($row['blocked'] ?? 0);

            $stats[(int) $project->id] = [
                'total' => $total,
                'done' => $done,
                'open' => $open,
                'overdue' => $overdue,
                'blocked' => $blocked,
                'unowned' => (int) ($row['unowned'] ?? 0),
                'logged_minutes' => (int) ($row['logged_minutes'] ?? 0),
                'estimated_minutes' => (int) ($row['estimated_minutes'] ?? 0),
                'budget_minutes' => $project->budget_minutes === null ? null : (int) $project->budget_minutes,
                'percent_complete' => $total > 0 ? (int) round($done / $total * 100) : 0,
                'health' => DeliveryHealth::forCounts($total, $open, $overdue, $blocked),
            ];
        }

        return $stats;
    }

    /**
     * @param  Collection<int, Client>  $clients
     * @return array<int, array<string, mixed>> keyed by client id
     */
    public function forClients(Collection $clients): array
    {
        $clientIds = $this->ids($clients);
        $projects = $clientIds === []
            ? new Collection
            : Project::query()->whereNull('archived_at')->whereIn('client_id', $clientIds)->get();

        $projectStats = $this->forProjects($projects);
        $byClient = $projects->groupBy('client_id');
        $retainerUsed = $this->retainerMinutesByClient(
            $clients->filter(fn (Client $client) => $client->retainer_minutes !== null)->pluck('id')->all()
        );
        $owners = $this->owners($byClient);

        $stats = [];
        foreach ($clients as $client) {
            $own = $byClient->get($client->id, new Collection)
                ->map(fn (Project $project) => $projectStats[(int) $project->id]);
            $retainer = $client->retainer_minutes === null ? null : (int) $client->retainer_minutes;

            $stats[(int) $client->id] = [
                'projects' => $own->count(),
                'open_tasks' => (int) $own->sum('open'),
                'overdue' => (int) $own->sum('overdue'),
                'blocked' => (int) $own->sum('blocked'),
                'logged_minutes' => (int) $own->sum('logged_minutes'),
                'retainer_minutes' => $retainer,
                'retainer_used_minutes' => $retainer === null ? null : ($retainerUsed[(int) $client->id] ?? 0),
                'health' => DeliveryHealth::worst($own->pluck('health')),
                'owner' => $owners[(int) $client->id] ?? null,
            ];
        }

        return $stats;
    }

    /**
     * The handful of tasks a person opening a project card would look at first.
     *
     * @param  Collection<int, Project>  $projects
     * @return array<int, array<int, array<string, mixed>>> keyed by project id
     */
    public function openTasks(Collection $projects): array
    {
        $ids = $this->ids($projects);
        if ($ids === []) {
            return [];
        }

        $today = Carbon::today()->toDateString();
        $tasks = Task::query()
            ->with(['status:id,key_name,label', 'urgency:id,key_name,label', 'assignee:id,first_name,last_name'])
            ->whereIn('project_id', $ids)
            ->whereNull('archived_at')
            ->whereNotIn('status_value_id', $this->doneStatusIds())
            ->get();

        $lists = [];
        foreach ($tasks->groupBy('project_id') as $projectId => $group) {
            $lists[(int) $projectId] = $group
                ->sort(fn (Task $a, Task $b) => $this->openTaskKey($a, $today) <=> $this->openTaskKey($b, $today))
                ->take(self::OPEN_TASKS_LIMIT)
                ->values()
                ->map(fn (Task $task) => [
                    'id' => (int) $task->id,
                    'title' => $task->title,
                    'status' => [
                        'label' => $task->status?->label,
                        'role' => TaskSignals::statusRole($task->status?->key_name),
                    ],
                    'urgency' => [
                        'label' => $task->urgency?->label,
                        'rank' => TaskSignals::urgencyRank($task->urgency?->key_name),
                    ],
                    'due_date' => $task->due_date?->toDateString(),
                    'assignee' => $this->person($task->assignee),
                ])->all();
        }

        foreach ($ids as $id) {
            $lists[$id] ??= [];
        }

        return $lists;
    }

    /**
     * Everyone carrying work on the project, plus its manager even with nothing
     * assigned: an empty team panel on a managed project would be a lie.
     *
     * @return array<int, array<string, mixed>>
     */
    public function team(Project $project): array
    {
        $doneIds = $this->doneStatusIds();
        $rows = Task::query()
            ->where('project_id', $project->id)
            ->whereNull('archived_at')
            ->whereNotNull('assignee_user_id')
            ->groupBy('assignee_user_id')
            ->selectRaw('assignee_user_id')
            ->selectRaw('sum(actual_minutes) as logged_minutes')
            ->selectRaw('sum(case when status_value_id in ('.$this->idList($doneIds).') then 0 else 1 end) as open_tasks')
            ->get()
            ->keyBy('assignee_user_id');

        $userIds = $rows->keys()->map(fn ($id) => (int) $id)->all();
        if ($project->manager_user_id && ! in_array((int) $project->manager_user_id, $userIds, true)) {
            $userIds[] = (int) $project->manager_user_id;
        }
        if ($userIds === []) {
            return [];
        }

        return User::query()
            ->whereIn('id', $userIds)
            ->get(['id', 'first_name', 'last_name'])
            ->map(fn (User $user) => [
                'id' => (int) $user->id,
                'first_name' => $user->first_name,
                'last_name' => $user->last_name,
                'open_tasks' => (int) ($rows[$user->id]->open_tasks ?? 0),
                'logged_minutes' => (int) ($rows[$user->id]->logged_minutes ?? 0),
                'is_manager' => (int) $project->manager_user_id === (int) $user->id,
            ])
            ->sort(fn (array $a, array $b) => [! $a['is_manager'], -$a['logged_minutes'], $a['id']]
                <=> [! $b['is_manager'], -$b['logged_minutes'], $b['id']])
            ->values()
            ->all();
    }

    /**
     * The same team figures for a whole list, in a fixed number of queries.
     *
     * The card grid shows faces, so calling team() per project would put an
     * N+1 behind a screen whose whole job is showing many projects at once.
     *
     * @return array<int, array<int, array<string, mixed>>> keyed by project id
     */
    public function teams(Collection $projects): array
    {
        $projectIds = $projects->pluck('id')->map(fn ($id) => (int) $id)->all();
        if ($projectIds === []) {
            return [];
        }

        $doneIds = $this->doneStatusIds();
        $rows = Task::query()
            ->whereIn('project_id', $projectIds)
            ->whereNull('archived_at')
            ->whereNotNull('assignee_user_id')
            ->groupBy('project_id', 'assignee_user_id')
            ->selectRaw('project_id, assignee_user_id')
            ->selectRaw('sum(actual_minutes) as logged_minutes')
            ->selectRaw('sum(case when status_value_id in ('.$this->idList($doneIds).') then 0 else 1 end) as open_tasks')
            ->get();

        $managers = $projects->pluck('manager_user_id', 'id')
            ->filter()
            ->map(fn ($id) => (int) $id)
            ->all();

        $userIds = $rows->pluck('assignee_user_id')->map(fn ($id) => (int) $id)
            ->merge(array_values($managers))
            ->unique()
            ->values()
            ->all();
        if ($userIds === []) {
            return [];
        }

        $users = User::query()->whereIn('id', $userIds)->get(['id', 'first_name', 'last_name'])->keyBy('id');
        $byProject = $rows->groupBy('project_id');

        $teams = [];
        foreach ($projectIds as $projectId) {
            $managerId = $managers[$projectId] ?? null;
            $memberRows = ($byProject[$projectId] ?? collect())->keyBy('assignee_user_id');
            $memberIds = $memberRows->keys()->map(fn ($id) => (int) $id)->all();
            if ($managerId && ! in_array($managerId, $memberIds, true)) {
                $memberIds[] = $managerId;
            }

            $team = [];
            foreach ($memberIds as $memberId) {
                $user = $users[$memberId] ?? null;
                if (! $user) {
                    continue;
                }
                $team[] = [
                    'id' => (int) $user->id,
                    'first_name' => $user->first_name,
                    'last_name' => $user->last_name,
                    'open_tasks' => (int) ($memberRows[$memberId]->open_tasks ?? 0),
                    'logged_minutes' => (int) ($memberRows[$memberId]->logged_minutes ?? 0),
                    'is_manager' => $managerId === $memberId,
                ];
            }

            usort($team, fn (array $a, array $b) => [! $a['is_manager'], -$a['logged_minutes'], $a['id']]
                <=> [! $b['is_manager'], -$b['logged_minutes'], $b['id']]);
            $teams[$projectId] = $team;
        }

        return $teams;
    }

    /**
     * Recent history on the given projects' tasks, phrased as sentences.
     *
     * @param  array<int, int>  $projectIds
     * @return array<int, array<string, mixed>>
     */
    public function activity(array $projectIds): array
    {
        if ($projectIds === []) {
            return [];
        }

        $titles = Task::query()->whereIn('project_id', $projectIds)->pluck('title', 'id');
        if ($titles->isEmpty()) {
            return [];
        }

        return AuditLog::query()
            ->with('user:id,first_name,last_name')
            ->where('entity_type', 'Task')
            ->whereIn('entity_id', $titles->keys()->all())
            ->whereNotNull('user_id')
            ->latest('id')
            ->limit(self::ACTIVITY_LIMIT)
            ->get()
            ->filter(fn (AuditLog $log) => $log->user !== null)
            ->map(fn (AuditLog $log) => [
                'id' => (int) $log->id,
                'user' => $this->person($log->user),
                'text' => trim($log->user->first_name.' '
                    .(self::ACTIVITY_VERBS[$log->action] ?? 'updated').' '
                    .$titles[(int) $log->entity_id]),
                'at' => ($log->created_at ?? Carbon::now())->toIso8601String(),
            ])->values()->all();
    }

    /**
     * Every count for a whole list of projects in one grouped query. Roles are
     * resolved to status ids up front so the SQL stays plain arithmetic.
     *
     * @param  array<int, int>  $projectIds
     * @return array<int, array<string, int>> keyed by project id
     */
    private function taskAggregates(array $projectIds): array
    {
        if ($projectIds === []) {
            return [];
        }

        $done = $this->idList($this->doneStatusIds());
        $blocked = $this->idList(TaskSignals::statusValueIdsForRoles(['blocked']));
        $today = Carbon::today()->toDateString();

        $rows = Task::query()
            ->whereIn('project_id', $projectIds)
            ->whereNull('archived_at')
            ->groupBy('project_id')
            ->selectRaw('project_id')
            ->selectRaw('count(*) as total')
            ->selectRaw("sum(case when status_value_id in ($done) then 1 else 0 end) as done")
            // Overdue, blocked, and unowned describe outstanding work only: a
            // finished task that landed late is history, not a problem.
            ->selectRaw("sum(case when status_value_id in ($done) then 0 when due_date < ? then 1 else 0 end) as overdue", [$today])
            ->selectRaw("sum(case when status_value_id in ($done) then 0 when status_value_id in ($blocked) then 1 else 0 end) as blocked")
            ->selectRaw("sum(case when status_value_id in ($done) then 0 when assignee_user_id is null then 1 else 0 end) as unowned")
            ->selectRaw('sum(actual_minutes) as logged_minutes')
            ->selectRaw('sum(estimated_minutes) as estimated_minutes')
            ->get();

        $aggregates = [];
        foreach ($rows as $row) {
            $aggregates[(int) $row->project_id] = [
                'total' => (int) $row->total,
                'done' => (int) $row->done,
                'overdue' => (int) $row->overdue,
                'blocked' => (int) $row->blocked,
                'unowned' => (int) $row->unowned,
                'logged_minutes' => (int) $row->logged_minutes,
                'estimated_minutes' => (int) $row->estimated_minutes,
            ];
        }

        return $aggregates;
    }

    /**
     * Minutes worked against each client this calendar month. This is the only
     * figure that has to come from the entries themselves, because the month
     * window cuts across the reconciled per-task totals. Same window and same
     * overlap arithmetic as the dashboard's retainer burn, so the two screens
     * report the same burn.
     *
     * @param  array<int, int>  $clientIds
     * @return array<int, int> keyed by client id
     */
    private function retainerMinutesByClient(array $clientIds): array
    {
        if ($clientIds === []) {
            return [];
        }

        $now = Carbon::now();
        $from = $now->copy()->startOfMonth();
        $entries = TimeEntry::query()
            ->join('tasks', 'tasks.id', '=', 'time_entries.task_id')
            ->join('projects', 'projects.id', '=', 'tasks.project_id')
            ->whereNull('tasks.deleted_at')
            ->whereNull('tasks.archived_at')
            ->whereNull('projects.deleted_at')
            ->whereNull('projects.archived_at')
            ->whereIn('projects.client_id', $clientIds)
            ->where('time_entries.kind', 'work')
            ->where('time_entries.started_at', '<', $now)
            ->where(fn ($inner) => $inner
                ->whereNull('time_entries.ended_at')
                ->orWhere('time_entries.ended_at', '>', $from))
            ->select('time_entries.*', 'projects.client_id as client_id')
            ->get();

        $seconds = [];
        foreach ($entries as $entry) {
            // A running timer counts up to now, so today's burn keeps moving.
            $end = $entry->ended_at ?? $now;
            $begin = $entry->started_at->gt($from) ? $entry->started_at : $from;
            $finish = $end->lt($now) ? $end : $now;
            $key = (int) $entry->client_id;
            $seconds[$key] = ($seconds[$key] ?? 0) + max(0, $finish->getTimestamp() - $begin->getTimestamp());
        }

        return array_map(fn (int $value) => (int) round($value / 60), $seconds);
    }

    /**
     * The manager running most of a client's work. A tie is broken by user id
     * rather than left blank, but a client whose projects name nobody has no
     * owner at all.
     *
     * @param  Collection<int, Collection<int, Project>>  $byClient
     * @return array<int, array<string, mixed>|null>
     */
    private function owners(Collection $byClient): array
    {
        $picks = [];
        foreach ($byClient as $clientId => $projects) {
            $counts = [];
            foreach ($projects as $project) {
                if ($project->manager_user_id) {
                    $counts[(int) $project->manager_user_id] = ($counts[(int) $project->manager_user_id] ?? 0) + 1;
                }
            }
            if ($counts === []) {
                continue;
            }
            $best = null;
            foreach ($counts as $userId => $count) {
                if ($best === null || [-$count, $userId] < [-$counts[$best], $best]) {
                    $best = $userId;
                }
            }
            $picks[(int) $clientId] = $best;
        }

        if ($picks === []) {
            return [];
        }

        $users = User::query()->whereIn('id', array_unique(array_values($picks)))->get(['id', 'first_name', 'last_name'])->keyBy('id');

        return array_map(fn (int $userId) => $this->person($users->get($userId)), $picks);
    }

    /** Overdue first, then urgency, then the nearest due date with nulls last. */
    private function openTaskKey(Task $task, string $today): array
    {
        $due = $task->due_date?->toDateString();

        return [
            $due !== null && $due < $today ? 0 : 1,
            TaskSignals::urgencyRank($task->urgency?->key_name),
            $due ?? '9999-12-31',
            (int) $task->id,
        ];
    }

    /** @return array<string, mixed>|null */
    private function person(?User $user): ?array
    {
        return $user === null ? null : [
            'id' => (int) $user->id,
            'first_name' => $user->first_name,
            'last_name' => $user->last_name,
        ];
    }

    /** @return array<int, int> */
    private function doneStatusIds(): array
    {
        return TaskSignals::statusValueIdsForRoles(['done']);
    }

    /**
     * An empty role resolves to an id nothing can match, keeping the `in (...)`
     * clause valid instead of producing broken SQL.
     *
     * @param  array<int, int>  $ids
     */
    private function idList(array $ids): string
    {
        return $ids === [] ? '0' : implode(',', array_map('intval', $ids));
    }

    /**
     * @param  Collection<int, mixed>  $models
     * @return array<int, int>
     */
    private function ids(Collection $models): array
    {
        return $models->pluck('id')->map(fn ($id) => (int) $id)->values()->all();
    }
}
