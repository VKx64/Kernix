<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Client;
use App\Models\FieldValue;
use App\Models\Project;
use App\Models\Task;
use App\Models\TimeEntry;
use App\Models\User;
use App\Support\TaskSignals;
use App\Support\TaskStatuses;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The portfolio screens: project cards, client rows, and the two detail pages
 * behind them. Every number here is derived, so the tests are about the rules
 * that derive it — health, completeness, and what counts as "this month".
 */
class PortfolioApiTest extends TestCase
{
    use RefreshDatabase;

    /** Mid-month, so "this month" has both a before and an after. */
    private const NOW = '2026-08-12 10:00:00';

    private User $admin;

    private Client $client;

    private Project $project;

    protected function setUp(): void
    {
        parent::setUp();

        TaskStatuses::flush();
        TaskSignals::flush();
        $this->seed();
        $this->travelTo(Carbon::parse(self::NOW));

        $this->admin = User::query()->findOrFail(1);
        $this->client = Client::query()->create(['name' => 'Northwind', 'created_by' => $this->admin->id]);
        $this->project = $this->makeProject('Website Relaunch');

        Sanctum::actingAs($this->admin);
    }

    public function test_the_project_list_stays_lean_until_stats_are_asked_for(): void
    {
        $this->makeTask($this->project, 'Something to count');

        $lean = $this->getJson('/api/projects')->assertOk()->json('data.0');
        $this->assertArrayNotHasKey('stats', $lean);
        $this->assertArrayNotHasKey('open_tasks', $lean);

        $rich = $this->getJson('/api/projects?stats=1')->assertOk()->json('data.0');
        $this->assertArrayHasKey('stats', $rich);
        $this->assertArrayHasKey('open_tasks', $rich);
    }

    public function test_a_project_with_no_tasks_is_on_track_and_zero_percent_done(): void
    {
        $stats = $this->projectStats($this->project);

        $this->assertSame('ontrack', $stats['health']);
        $this->assertSame(0, $stats['percent_complete']);
        $this->assertSame(0, $stats['total']);
        $this->assertNull($stats['budget_minutes']);
        $this->assertSame([], $this->projectRow($this->project)['open_tasks']);
    }

    public function test_clean_open_work_reads_on_track(): void
    {
        $this->makeTask($this->project, 'Due next week', ['due_date' => '2026-08-20']);
        $this->makeTask($this->project, 'No due date at all', ['due_date' => null]);

        $this->assertSame('ontrack', $this->projectStats($this->project)['health']);
    }

    public function test_one_slip_reads_at_risk_and_three_read_off_track(): void
    {
        $this->makeTask($this->project, 'Late one', ['due_date' => '2026-08-10']);
        $this->makeTask($this->project, 'On time', ['due_date' => '2026-08-20']);

        $this->assertSame('atrisk', $this->projectStats($this->project)['health']);

        $this->makeTask($this->project, 'Late two', ['due_date' => '2026-08-09']);
        $this->makeTask($this->project, 'Late three', ['due_date' => '2026-08-08']);

        $this->assertSame('offtrack', $this->projectStats($this->project)['health']);
    }

    public function test_one_blocked_task_is_at_risk_and_two_are_off_track(): void
    {
        $this->makeTask($this->project, 'Waiting on assets', ['status_value_id' => $this->statusId('blocked')]);

        $this->assertSame('atrisk', $this->projectStats($this->project)['health']);

        $this->makeTask($this->project, 'Needs a rework', ['status_value_id' => $this->statusId('needs_correction')]);

        $this->assertSame('offtrack', $this->projectStats($this->project)['health']);
    }

    public function test_finished_work_reads_done_even_when_all_of_it_landed_late(): void
    {
        foreach (['One', 'Two', 'Three', 'Four'] as $title) {
            $this->makeTask($this->project, "Late but shipped: {$title}", [
                'due_date' => '2026-08-01',
                'status_value_id' => $this->statusId('complete'),
            ]);
        }

        $stats = $this->projectStats($this->project);

        $this->assertSame('done', $stats['health']);
        $this->assertSame(100, $stats['percent_complete']);
        // A closed task is history, not a problem still to be solved.
        $this->assertSame(0, $stats['overdue']);
        $this->assertSame(0, $stats['open']);
    }

    public function test_the_counts_split_open_work_by_what_is_wrong_with_it(): void
    {
        $this->makeTask($this->project, 'Late and nobody owns it', [
            'due_date' => '2026-08-10',
            'assignee_user_id' => null,
            'estimated_minutes' => 60,
            'actual_minutes' => 90,
        ]);
        $this->makeTask($this->project, 'Blocked', [
            'status_value_id' => $this->statusId('blocked'),
            'estimated_minutes' => 30,
            'actual_minutes' => 10,
        ]);
        $this->makeTask($this->project, 'Shipped', [
            'status_value_id' => $this->statusId('complete'),
            'due_date' => '2026-08-02',
            'estimated_minutes' => 120,
            'actual_minutes' => 100,
        ]);

        $stats = $this->projectStats($this->project);

        $this->assertSame([
            'total' => 3, 'done' => 1, 'open' => 2, 'overdue' => 1, 'blocked' => 1, 'unowned' => 1,
        ], array_intersect_key($stats, array_flip(['total', 'done', 'open', 'overdue', 'blocked', 'unowned'])));
        $this->assertSame(200, $stats['logged_minutes']);
        $this->assertSame(210, $stats['estimated_minutes']);
        $this->assertSame(33, $stats['percent_complete']);
    }

    public function test_percent_complete_rounds_to_a_whole_number(): void
    {
        foreach (range(1, 3) as $index) {
            $this->makeTask($this->project, "Open {$index}");
        }
        foreach (range(1, 5) as $index) {
            $this->makeTask($this->project, "Closed {$index}", ['status_value_id' => $this->statusId('complete')]);
        }

        // 5 of 8 is 62.5, which rounds up.
        $this->assertSame(63, $this->projectStats($this->project)['percent_complete']);
    }

    public function test_the_budget_is_the_projects_own_minutes(): void
    {
        $this->project->update(['budget_minutes' => 4800]);
        $this->makeTask($this->project, 'Tracked', ['actual_minutes' => 4200]);

        $stats = $this->projectStats($this->project);

        $this->assertSame(4800, $stats['budget_minutes']);
        $this->assertSame(4200, $stats['logged_minutes']);
    }

    public function test_open_tasks_are_capped_at_five_and_led_by_the_overdue_and_urgent(): void
    {
        $urgentToday = $this->makeTask($this->project, 'Urgent, due today', [
            'due_date' => '2026-08-12',
            'urgency_value_id' => $this->urgencyId('urgent'),
        ]);
        $overdueLow = $this->makeTask($this->project, 'Low, but three days late', [
            'due_date' => '2026-08-09',
            'urgency_value_id' => $this->urgencyId('low'),
        ]);
        $overdueHigh = $this->makeTask($this->project, 'High, one day late', [
            'due_date' => '2026-08-11',
            'urgency_value_id' => $this->urgencyId('high'),
        ]);
        $soon = $this->makeTask($this->project, 'Normal, due tomorrow', ['due_date' => '2026-08-13']);
        $undated = $this->makeTask($this->project, 'Normal, no due date', ['due_date' => null]);
        $later = $this->makeTask($this->project, 'Normal, due next month', ['due_date' => '2026-09-13']);
        $this->makeTask($this->project, 'Already shipped', ['status_value_id' => $this->statusId('complete')]);

        $open = $this->projectRow($this->project)['open_tasks'];

        $this->assertSame(
            [$overdueHigh->id, $overdueLow->id, $urgentToday->id, $soon->id, $later->id],
            array_column($open, 'id'),
        );
        $this->assertNotContains($undated->id, array_column($open, 'id'));
        $this->assertSame('Pending', $open[0]['status']['label']);
        $this->assertSame('open', $open[0]['status']['role']);
        $this->assertSame(1, $open[0]['urgency']['rank']);
        $this->assertSame('2026-08-11', $open[0]['due_date']);
        $this->assertSame(
            ['id' => $this->admin->id, 'first_name' => 'Admin', 'last_name' => 'User'],
            $open[0]['assignee'],
        );
    }

    public function test_archived_projects_and_tasks_stay_out_of_every_number(): void
    {
        $this->makeTask($this->project, 'Counts', ['due_date' => '2026-08-20']);
        $this->makeTask($this->project, 'Archived and late', [
            'due_date' => '2026-08-01',
            'archived_at' => now(),
            'actual_minutes' => 500,
        ]);
        $archivedProject = $this->makeProject('Shelved', ['archived_at' => now()]);
        $this->makeTask($archivedProject, 'Late on a shelved project', ['due_date' => '2026-08-01']);

        $stats = $this->projectStats($this->project);

        $this->assertSame(1, $stats['total']);
        $this->assertSame(0, $stats['overdue']);
        $this->assertSame(0, $stats['logged_minutes']);
        $this->assertSame('ontrack', $stats['health']);

        $clientStats = $this->clientStats($this->client);
        $this->assertSame(1, $clientStats['projects']);
        $this->assertSame(1, $clientStats['open_tasks']);
        $this->assertSame('ontrack', $clientStats['health']);
    }

    public function test_a_client_takes_the_worst_health_among_its_projects(): void
    {
        $healthy = $this->makeProject('All fine');
        $this->makeTask($healthy, 'On time', ['due_date' => '2026-08-20']);
        $shipped = $this->makeProject('All shipped');
        $this->makeTask($shipped, 'Delivered', ['status_value_id' => $this->statusId('complete')]);

        $this->assertSame('ontrack', $this->clientStats($this->client)['health']);

        $this->makeTask($this->project, 'One slip', ['due_date' => '2026-08-10']);
        $this->assertSame('atrisk', $this->clientStats($this->client)['health']);

        $this->makeTask($this->project, 'Blocked too', ['status_value_id' => $this->statusId('blocked')]);
        $this->makeTask($this->project, 'And another', ['status_value_id' => $this->statusId('blocked')]);
        $this->assertSame('offtrack', $this->clientStats($this->client)['health']);
    }

    public function test_a_client_with_no_projects_is_on_track_with_no_owner(): void
    {
        $bare = Client::query()->create(['name' => 'Nothing started yet', 'created_by' => $this->admin->id]);

        $stats = $this->clientStats($bare);

        $this->assertSame('ontrack', $stats['health']);
        $this->assertSame(0, $stats['projects']);
        $this->assertNull($stats['owner']);
        $this->assertNull($stats['retainer_minutes']);
        $this->assertNull($stats['retainer_used_minutes']);
    }

    public function test_the_client_owner_is_the_manager_running_most_of_the_work(): void
    {
        $liam = User::factory()->create(['first_name' => 'Liam', 'last_name' => 'Cruz']);
        $this->project->update(['manager_user_id' => $liam->id]);
        $this->makeProject('Second', ['manager_user_id' => $liam->id]);
        $this->makeProject('Third', ['manager_user_id' => $this->admin->id]);

        $this->assertSame(
            ['id' => $liam->id, 'first_name' => 'Liam', 'last_name' => 'Cruz'],
            $this->clientStats($this->client)['owner'],
        );
    }

    public function test_the_retainer_burn_counts_this_month_while_logged_time_counts_everything(): void
    {
        $this->client->update(['retainer_minutes' => 4800]);
        $task = $this->makeTask($this->project, 'Tracked', ['actual_minutes' => 9400]);

        $this->entry($task, '2026-07-30 09:00:00', '2026-07-30 17:00:00');
        $this->entry($task, '2026-08-03 09:00:00', '2026-08-03 13:00:00');
        $this->entry($task, '2026-08-12 08:00:00', '2026-08-12 09:00:00');
        // A break never burns the allowance.
        $this->entry($task, '2026-08-12 09:00:00', '2026-08-12 09:30:00', 'break');

        $stats = $this->clientStats($this->client);

        $this->assertSame(4800, $stats['retainer_minutes']);
        $this->assertSame(300, $stats['retainer_used_minutes']);
        $this->assertSame(9400, $stats['logged_minutes']);
    }

    public function test_a_client_without_an_allowance_has_no_burn_to_report(): void
    {
        $task = $this->makeTask($this->project, 'Tracked', ['actual_minutes' => 120]);
        $this->entry($task, '2026-08-03 09:00:00', '2026-08-03 11:00:00');

        $stats = $this->clientStats($this->client);

        $this->assertNull($stats['retainer_minutes']);
        $this->assertNull($stats['retainer_used_minutes']);
        $this->assertSame(120, $stats['logged_minutes']);
    }

    public function test_the_client_list_is_lean_until_stats_are_asked_for(): void
    {
        $this->assertArrayNotHasKey('stats', $this->getJson('/api/clients')->assertOk()->json('data.0'));
        $this->assertArrayHasKey('stats', $this->getJson('/api/clients?stats=1')->assertOk()->json('data.0'));
    }

    public function test_the_project_page_lists_the_team_including_a_manager_with_nothing_assigned(): void
    {
        $manager = User::factory()->create(['first_name' => 'Maria', 'last_name' => 'Santos']);
        $worker = User::factory()->create(['first_name' => 'Liam', 'last_name' => 'Cruz']);
        $this->project->update(['manager_user_id' => $manager->id]);

        $this->makeTask($this->project, 'Open work', ['assignee_user_id' => $worker->id, 'actual_minutes' => 600]);
        $this->makeTask($this->project, 'More open work', ['assignee_user_id' => $worker->id, 'actual_minutes' => 300]);
        $this->makeTask($this->project, 'Closed work', [
            'assignee_user_id' => $worker->id,
            'status_value_id' => $this->statusId('complete'),
            'actual_minutes' => 100,
        ]);
        $this->makeTask($this->project, 'Archived work', [
            'assignee_user_id' => $worker->id,
            'archived_at' => now(),
            'actual_minutes' => 900,
        ]);
        $this->makeTask($this->project, 'Nobody owns this', ['assignee_user_id' => null]);

        $team = $this->getJson("/api/projects/{$this->project->id}")->assertOk()->json('data.team');

        $this->assertSame([$manager->id, $worker->id], array_column($team, 'id'));
        $this->assertTrue($team[0]['is_manager']);
        $this->assertSame(0, $team[0]['open_tasks']);
        $this->assertSame(0, $team[0]['logged_minutes']);
        $this->assertFalse($team[1]['is_manager']);
        $this->assertSame(2, $team[1]['open_tasks']);
        $this->assertSame(1000, $team[1]['logged_minutes']);
    }

    public function test_the_project_page_narrates_recent_history_on_its_tasks(): void
    {
        $liam = User::factory()->create(['first_name' => 'Liam', 'last_name' => 'Cruz']);
        $mine = $this->makeTask($this->project, 'Ship the ad creatives');
        $elsewhere = $this->makeTask($this->makeProject('Another project'), 'Unrelated');

        $log = AuditLog::query()->create([
            'user_id' => $liam->id,
            'action' => 'task.subtask.complete',
            'entity_type' => 'Task',
            'entity_id' => $mine->id,
            'summary' => 'task.subtask.complete',
        ]);
        AuditLog::query()->create([
            'user_id' => $liam->id,
            'action' => 'task.update',
            'entity_type' => 'Task',
            'entity_id' => $elsewhere->id,
            'summary' => 'task.update',
        ]);

        $activity = $this->getJson("/api/projects/{$this->project->id}")->assertOk()->json('data.activity');

        $this->assertSame([$log->id], array_column($activity, 'id'));
        $this->assertSame('Liam completed a subtask on Ship the ad creatives', $activity[0]['text']);
        $this->assertSame(
            ['id' => $liam->id, 'first_name' => 'Liam', 'last_name' => 'Cruz'],
            $activity[0]['user'],
        );
        $this->assertStringStartsWith('2026-08-12T', $activity[0]['at']);
    }

    public function test_the_client_page_carries_one_row_per_live_project(): void
    {
        $this->makeTask($this->project, 'Late', ['due_date' => '2026-08-01']);
        $second = $this->makeProject('Q3 Social Campaign');
        $this->makeTask($second, 'Fine', ['due_date' => '2026-08-30']);
        $this->makeProject('Shelved', ['archived_at' => now()]);

        $payload = $this->getJson("/api/clients/{$this->client->id}")->assertOk()->json('data');

        $this->assertSame(['Q3 Social Campaign', 'Website Relaunch'], array_column($payload['projects'], 'name'));
        $this->assertSame('atrisk', $payload['stats']['health']);
        $this->assertSame('ontrack', $payload['projects'][0]['stats']['health']);
        $this->assertSame('atrisk', $payload['projects'][1]['stats']['health']);
        $this->assertArrayHasKey('contacts', $payload);
        $this->assertSame([], $payload['activity']);
    }

    public function test_the_client_list_answers_a_whole_portfolio_without_an_n_plus_one(): void
    {
        for ($c = 1; $c <= 5; $c++) {
            $client = Client::query()->create([
                'name' => "Client {$c}",
                'retainer_minutes' => 2400,
                'created_by' => $this->admin->id,
            ]);
            for ($p = 1; $p <= 3; $p++) {
                $project = Project::query()->create([
                    'client_id' => $client->id,
                    'name' => "Client {$c} project {$p}",
                    'manager_user_id' => $this->admin->id,
                    'created_by' => $this->admin->id,
                ]);
                $task = $this->makeTask($project, "Client {$c} project {$p} task", ['due_date' => '2026-08-01']);
                $this->entry($task, '2026-08-05 09:00:00', '2026-08-05 10:00:00');
            }
        }

        DB::enableQueryLog();
        $response = $this->getJson('/api/clients?stats=1')->assertOk();
        $queries = count(DB::getQueryLog());
        DB::disableQueryLog();

        $this->assertCount(6, $response->json('data'));
        $this->assertSame(180, collect($response->json('data'))->firstWhere('name', 'Client 1')['stats']['retainer_used_minutes']);
        $this->assertLessThan(30, $queries, "GET /api/clients?stats=1 issued {$queries} queries.");
    }

    /** @return array<string, mixed> */
    private function projectStats(Project $project): array
    {
        return $this->projectRow($project)['stats'];
    }

    /** @return array<string, mixed> */
    private function projectRow(Project $project): array
    {
        $row = collect($this->getJson('/api/projects?stats=1')->assertOk()->json('data'))
            ->firstWhere('id', $project->id);
        $this->assertNotNull($row, "Project {$project->id} is missing from the list.");

        return $row;
    }

    /** @return array<string, mixed> */
    private function clientStats(Client $client): array
    {
        $row = collect($this->getJson('/api/clients?stats=1')->assertOk()->json('data'))
            ->firstWhere('id', $client->id);
        $this->assertNotNull($row, "Client {$client->id} is missing from the list.");

        return $row['stats'];
    }

    private function makeProject(string $name, array $overrides = []): Project
    {
        return Project::query()->create(array_merge([
            'client_id' => $this->client->id,
            'name' => $name,
            'created_by' => $this->admin->id,
        ], $overrides));
    }

    private function makeTask(Project $project, string $title, array $overrides = []): Task
    {
        return Task::query()->create(array_merge([
            'project_id' => $project->id,
            'title' => $title,
            'status_value_id' => $this->statusId('pending'),
            'urgency_value_id' => $this->urgencyId('normal'),
            'assignee_user_id' => $this->admin->id,
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ], $overrides));
    }

    private function entry(Task $task, string $startedAt, string $endedAt, string $kind = 'work'): TimeEntry
    {
        return TimeEntry::query()->create([
            'user_id' => $this->admin->id,
            'task_id' => $task->id,
            'kind' => $kind,
            'started_at' => Carbon::parse($startedAt),
            'ended_at' => Carbon::parse($endedAt),
        ]);
    }

    private function statusId(string $key): int
    {
        return (int) FieldValue::query()->where('key_name', $key)
            ->whereHas('field', fn ($field) => $field->where('key_name', 'task_status'))->value('id');
    }

    private function urgencyId(string $key): int
    {
        return (int) FieldValue::query()->where('key_name', $key)
            ->whereHas('field', fn ($field) => $field->where('key_name', 'task_urgency'))->value('id');
    }
}
