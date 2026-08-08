<?php

namespace Database\Seeders;

use App\Models\Client;
use App\Models\FieldValue;
use App\Models\Project;
use App\Models\Role;
use App\Models\Task;
use App\Models\TaskNote;
use App\Models\TaskSubtask;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Hash;
use LogicException;

/**
 * DEMO — populates an otherwise-empty local database with clients, projects,
 * users, and tasks so the Tasks Triage screen has something to show. It is
 * deliberately excluded from `DatabaseSeeder::run` and only runs when named
 * explicitly:
 *
 *   php artisan db:seed --class=DemoWorkspaceSeeder
 *
 * Every row is created with `firstOrCreate`/`updateOrCreate` on a stable
 * natural key, so running this twice leaves the same row counts. Requires
 * the normal seed (user 1, roles, field values) to already exist.
 */
class DemoWorkspaceSeeder extends Seeder
{
    // Demo credential only, never used in production. This seeder is not
    // invoked by the default seed path.
    private const DEMO_PASSWORD = 'DemoPass123!Demo';

    /**
     * Monthly allowances in minutes. The two clients left out deliberately have
     * no retainer, so the dashboard's burn list has something to exclude.
     */
    private const RETAINER_MINUTES = [
        'Northwind Creative' => 4800,
        'Bluepeak Studios' => 2400,
        'Ironclad Media' => 6000,
        'Lumen Digital' => 3600,
    ];

    public function run(): void
    {
        $admin = User::query()->find(1);
        if (! $admin) {
            throw new LogicException('Run the default seed (php artisan db:seed) before DemoWorkspaceSeeder.');
        }

        $employeeRoleId = Role::query()->where('key_name', 'employee_role')->value('id');
        if (! $employeeRoleId) {
            throw new LogicException('Employee Role is missing; run the default seed before DemoWorkspaceSeeder.');
        }

        $clients = $this->seedClients($admin);
        $projects = $this->seedProjects($clients, $admin);
        $employees = $this->seedEmployees($employeeRoleId);
        $this->seedTasks($projects, array_merge([$admin], $employees), $admin);
        $this->seedTimeEntries($employees);
    }

    /** @return array<string, Client> keyed by client name */
    private function seedClients(User $admin): array
    {
        $names = [
            'Northwind Creative', 'Bluepeak Studios', 'Ironclad Media',
            'Lumen Digital', 'Solstice Brands', 'Anchor & Co.',
        ];
        $activeStatusId = $this->fieldValueId('client_status', 'active');

        $clients = [];
        foreach ($names as $name) {
            $clients[$name] = Client::query()->firstOrCreate(
                ['name' => $name],
                ['status_value_id' => $activeStatusId, 'created_by' => $admin->id],
            );
        }
        // Set outside firstOrCreate so an existing demo database picks the
        // allowances up too.
        foreach (self::RETAINER_MINUTES as $name => $minutes) {
            $clients[$name]->update(['retainer_minutes' => $minutes]);
        }

        return $clients;
    }

    /** @param array<string, Client> $clients @return array<string, Project> keyed by project name */
    private function seedProjects(array $clients, User $admin): array
    {
        $activeId = $this->fieldValueId('project_status', 'active');
        $onHoldId = $this->fieldValueId('project_status', 'on_hold');

        $definitions = [
            ['Website Relaunch', 'Northwind Creative', $activeId],
            ['Q3 Social Campaign', 'Northwind Creative', $activeId],
            ['Brand Identity Refresh', 'Bluepeak Studios', $onHoldId],
            ['Product Launch Video', 'Ironclad Media', $activeId],
            ['SEO Overhaul', 'Lumen Digital', $activeId],
            ['App Redesign', 'Solstice Brands', $onHoldId],
            ['Investor Deck', 'Anchor & Co.', $activeId],
        ];

        $projects = [];
        foreach ($definitions as [$name, $clientName, $statusId]) {
            $projects[$name] = Project::query()->firstOrCreate(
                ['name' => $name, 'client_id' => $clients[$clientName]->id],
                ['status_value_id' => $statusId, 'manager_user_id' => $admin->id, 'created_by' => $admin->id],
            );
        }

        return $projects;
    }

    /** @return array<int, User> */
    private function seedEmployees(int $roleId): array
    {
        $definitions = [
            ['msantos', 'Maria', 'Santos'],
            ['lcruz', 'Liam', 'Cruz'],
            ['areyes', 'Ava', 'Reyes'],
            ['nbautista', 'Noah', 'Bautista'],
            ['sramirez', 'Sofia', 'Ramirez'],
        ];

        $employees = [];
        foreach ($definitions as [$username, $firstName, $lastName]) {
            $employees[] = User::query()->firstOrCreate(
                ['username' => $username],
                [
                    'role_id' => $roleId,
                    'password_hash' => Hash::make(self::DEMO_PASSWORD),
                    'first_name' => $firstName,
                    'last_name' => $lastName,
                    'status' => 'active',
                    'timezone' => 'Asia/Manila',
                ],
            );
        }

        return $employees;
    }

    /**
     * @param  array<string, Project>  $projects
     * @param  array<int, User>  $people  admin followed by employees
     */
    private function seedTasks(array $projects, array $people, User $admin): void
    {
        $today = Carbon::today();
        $projectPool = array_values($projects);
        [$admin, $e1, $e2, $e3, $e4, $e5] = $people;

        $pending = $this->fieldValueId('task_status', 'pending');
        $planning = $this->fieldValueId('task_status', 'planning');
        $inProgress = $this->fieldValueId('task_status', 'in_progress');
        $qualityCheck = $this->fieldValueId('task_status', 'quality_check');
        $needsCorrection = $this->fieldValueId('task_status', 'needs_correction');
        $blocked = $this->fieldValueId('task_status', 'blocked');
        $complete = $this->fieldValueId('task_status', 'complete');

        $urgent = $this->fieldValueId('task_urgency', 'urgent');
        $high = $this->fieldValueId('task_urgency', 'high');
        $normal = $this->fieldValueId('task_urgency', 'normal');
        $low = $this->fieldValueId('task_urgency', 'low');

        $task = $this->fieldValueId('task_type', 'task');
        $bug = $this->fieldValueId('task_type', 'bug');
        $feature = $this->fieldValueId('task_type', 'feature');
        $request = $this->fieldValueId('task_type', 'request');

        // Each row: title, project, status, urgency, type, due date, assignee, estimate, actual, subtasks, notes
        $definitions = [
            // Overdue 1-5 days
            ['Fix broken checkout links', $projectPool[0], $inProgress, $high, $bug, $today->copy()->subDays(1), $e1, 90, 45, 3, true],
            ['Deliver revised homepage copy', $projectPool[0], $pending, $normal, $task, $today->copy()->subDays(2), $e2, 120, 0, 0, false],
            ['Ship social ad creatives batch 2', $projectPool[1], $inProgress, $high, $task, $today->copy()->subDays(3), $e3, 180, 120, 2, false],
            ['Resolve font licensing issue', $projectPool[2], $pending, $normal, $bug, $today->copy()->subDays(4), null, 60, 0, 0, false],
            ['Send investor deck for legal review', $projectPool[6], $inProgress, $high, $request, $today->copy()->subDays(5), $e4, 90, 60, 0, true],

            // Due today
            ['Publish Q3 campaign teaser', $projectPool[1], $inProgress, $normal, $task, $today->copy(), $e3, 60, 30, 0, false],
            ['Approve final storyboard', $projectPool[3], $pending, $high, $request, $today->copy(), $e5, 45, 0, 2, false],
            ['Submit SEO audit report', $projectPool[4], $inProgress, $normal, $task, $today->copy(), $e1, 150, 90, 0, false],

            // Blocked
            ['Waiting on client brand assets', $projectPool[2], $blocked, $normal, $task, $today->copy()->addDays(3), $e2, 60, 15, 0, true],
            ['Blocked on API credentials', $projectPool[0], $blocked, $high, $bug, $today->copy()->addDays(2), $e1, 40, 10, 0, false],
            ['Awaiting legal sign-off on script', $projectPool[3], $blocked, $normal, $request, null, $e4, 30, 0, 0, false],
            ['Blocked by third-party vendor delay', $projectPool[5], $blocked, $low, $task, $today->copy()->addDays(10), null, 50, 0, 0, false],

            // Quality check
            ['Review new landing page build', $projectPool[0], $qualityCheck, $normal, $task, $today->copy()->addDays(1), $e2, 90, 85, 3, true],
            ['QA the mobile app redesign flow', $projectPool[5], $qualityCheck, $high, $feature, $today->copy()->addDays(2), $e3, 200, 190, 4, false],
            ['Verify translated ad copy', $projectPool[1], $qualityCheck, $normal, $task, $today->copy()->addDays(4), $e5, 45, 40, 0, false],
            ['Check video export against brief', $projectPool[3], $qualityCheck, $normal, $task, $today->copy()->addDays(3), $e1, 60, 55, 0, false],

            // Urgent and unassigned
            ['Urgent: hotfix contact form', $projectPool[0], $pending, $urgent, $bug, $today->copy()->addDays(1), null, 30, 0, 0, false],
            ['Urgent: replace expired SSL cert', $projectPool[4], $pending, $urgent, $bug, null, null, 20, 0, 0, false],
            ['Urgent: client asked for same-day revision', $projectPool[6], $planning, $urgent, $request, $today->copy(), null, 30, 0, 0, false],
            ['High priority: reshoot damaged b-roll', $projectPool[3], $planning, $high, $task, $today->copy()->addDays(1), null, 240, 0, 0, false],

            // No due date
            ['Explore new brand color palette', $projectPool[2], $planning, $low, $task, null, $e2, 60, 0, 2, false],
            ['Draft long-term SEO roadmap', $projectPool[4], $planning, $normal, $task, null, $e1, 180, 0, 0, false],
            ['Research competitor app patterns', $projectPool[5], $planning, $low, $task, null, $e3, 90, 0, 0, false],
            ['Collect testimonials for pitch deck', $projectPool[6], $pending, $normal, $request, null, $e4, 60, 20, 0, false],

            // Needs correction
            ['Revise rejected ad variant', $projectPool[1], $needsCorrection, $high, $task, $today->copy()->addDays(1), $e3, 45, 30, 0, true],
            ['Fix inconsistent spacing on landing page', $projectPool[0], $needsCorrection, $normal, $bug, $today->copy()->addDays(2), $e2, 30, 20, 0, false],

            // Complete
            ['Finalize sitemap structure', $projectPool[0], $complete, $normal, $task, $today->copy()->subDays(10), $e1, 60, 65, 2, false],
            ['Deliver kickoff social assets', $projectPool[1], $complete, $normal, $task, $today->copy()->subDays(8), $e3, 90, 88, 0, false],
            ['Approve brand mood board', $projectPool[2], $complete, $normal, $task, $today->copy()->subDays(12), $e2, 40, 35, 0, false],
            ['Ship teaser trailer v1', $projectPool[3], $complete, $normal, $feature, $today->copy()->subDays(6), $e5, 200, 210, 4, false],
            ['Close out onboarding survey', $projectPool[4], $complete, $low, $task, $today->copy()->subDays(15), $e1, 30, 25, 0, false],

            // Normal in-progress fill
            ['Build homepage hero section', $projectPool[0], $inProgress, $normal, $feature, $today->copy()->addDays(5), $admin, 120, 40, 3, false],
            ['Schedule next social batch', $projectPool[1], $pending, $normal, $task, $today->copy()->addDays(7), $e3, 60, 0, 0, false],
            ['Draft app onboarding copy', $projectPool[5], $pending, $normal, $task, $today->copy()->addDays(6), $e5, 60, 0, 0, false],
        ];

        foreach ($definitions as [$title, $project, $statusId, $urgencyId, $typeId, $dueDate, $assignee, $estimated, $actual, $subtaskCount, $addNote]) {
            $created = Task::query()->firstOrCreate(
                ['title' => $title],
                [
                    'project_id' => $project->id,
                    'status_value_id' => $statusId,
                    'urgency_value_id' => $urgencyId,
                    'type_value_id' => $typeId,
                    'due_date' => $dueDate?->toDateString(),
                    'assignee_user_id' => $assignee?->id,
                    'estimated_minutes' => $estimated,
                    'actual_minutes' => $actual,
                    'created_by' => $admin->id,
                ],
            );

            if (! $created->wasRecentlyCreated) {
                continue;
            }

            for ($i = 1; $i <= $subtaskCount; $i++) {
                TaskSubtask::query()->create([
                    'task_id' => $created->id,
                    'title' => "{$title} — subtask {$i}",
                    'status_value_id' => $i <= (int) ceil($subtaskCount / 2) ? $complete : $pending,
                    'assignee_user_id' => $assignee?->id,
                    'sort_order' => $i * 10,
                    'estimated_minutes' => 30,
                    'actual_minutes' => $i <= (int) ceil($subtaskCount / 2) ? 30 : 0,
                    'completed_at' => $i <= (int) ceil($subtaskCount / 2) ? now() : null,
                    'created_by' => $admin->id,
                ]);
            }

            if ($addNote) {
                TaskNote::query()->create([
                    'task_id' => $created->id,
                    'body' => "Discussion started on \"{$title}\".",
                    'created_by' => $assignee?->id ?? $admin->id,
                ]);
            }
        }
    }

    /**
     * Closed timer entries across the current week and the current month, so
     * the dashboard's week chart and retainer burn line are not flat. Shapes
     * are derived from the calendar date rather than randomised, so two runs on
     * the same day produce byte-identical rows.
     *
     * @param  array<int, User>  $employees
     */
    private function seedTimeEntries(array $employees): void
    {
        $now = Carbon::now();
        // Far enough back to cover the current month and the week before this
        // one, so the dashboard has a previous-week total to compare against.
        $start = $now->copy()->startOfMonth()->min($now->copy()->startOfWeek(Carbon::MONDAY)->subWeek());

        foreach (array_slice($employees, 0, 3) as $index => $employee) {
            $taskIds = Task::query()->where('assignee_user_id', $employee->id)->orderBy('id')->pluck('id')->all();
            if ($taskIds === []) {
                continue;
            }

            for ($day = $start->copy(); $day->lte($now); $day->addDay()) {
                if (! $day->isWeekday()) {
                    continue;
                }
                $offset = $day->day + $index * 7;
                $blocks = [
                    ['work', 9, 90 + ($offset % 5) * 15],
                    ['break', 12, 30],
                    ['work', 13, 120 + (($day->day * 3 + $index) % 4) * 20],
                ];
                foreach ($blocks as $slot => [$kind, $hour, $minutes]) {
                    $startedAt = $day->copy()->setTime($hour, 0);
                    if ($startedAt->gte($now)) {
                        continue;
                    }
                    TimeEntry::query()->firstOrCreate(
                        ['user_id' => $employee->id, 'started_at' => $startedAt],
                        [
                            'task_id' => $kind === 'work' ? $taskIds[($offset + $slot) % count($taskIds)] : null,
                            'kind' => $kind,
                            'break_kind' => $kind === 'break' ? 'Lunch' : null,
                            'break_due_minutes' => $kind === 'break' ? 30 : null,
                            'ended_at' => $startedAt->copy()->addMinutes($minutes)->min($now),
                        ],
                    );
                }
            }
        }
    }

    private function fieldValueId(string $fieldKey, string $valueKey): int
    {
        $id = FieldValue::query()
            ->where('key_name', $valueKey)
            ->whereHas('field', fn ($field) => $field->where('key_name', $fieldKey))
            ->value('id');

        if (! $id) {
            throw new LogicException("Missing field value {$fieldKey}.{$valueKey}; run the default seed before DemoWorkspaceSeeder.");
        }

        return (int) $id;
    }
}
