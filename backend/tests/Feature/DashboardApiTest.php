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
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The dashboard answers "what do I work on right now" for one employee. Every
 * number on it has to trace back to a task assigned to the requester or to a
 * time entry, so the tests here are mostly about scope and ordering.
 */
class DashboardApiTest extends TestCase
{
    use RefreshDatabase;

    /** A Wednesday: the week runs Mon 10 Aug to Sun 16 Aug. */
    private const NOW = '2026-08-12 10:00:00';

    private User $user;

    private User $other;

    private Client $client;

    private Project $project;

    protected function setUp(): void
    {
        parent::setUp();

        TaskStatuses::flush();
        TaskSignals::flush();
        $this->seed();
        $this->travelTo(Carbon::parse(self::NOW));

        $this->user = User::query()->findOrFail(1);
        $this->other = User::factory()->create(['first_name' => 'Liam', 'last_name' => 'Cruz']);
        $this->client = Client::query()->create(['name' => 'Northwind', 'created_by' => $this->user->id]);
        $this->project = Project::query()->create([
            'client_id' => $this->client->id,
            'name' => 'Website Relaunch',
            'created_by' => $this->user->id,
        ]);

        Sanctum::actingAs($this->user);
    }

    public function test_an_unknown_range_is_rejected(): void
    {
        $this->getJson('/api/dashboard?range=month')
            ->assertUnprocessable()
            ->assertJsonValidationErrors('range');
    }

    public function test_the_envelope_carries_the_day_the_greeting_and_the_target(): void
    {
        $this->getJson('/api/dashboard')
            ->assertOk()
            ->assertJsonPath('data.range', 'today')
            ->assertJsonPath('data.date', '2026-08-12')
            ->assertJsonPath('data.greeting_name', 'Admin')
            ->assertJsonPath('data.daily_target_minutes', 420)
            ->assertJsonPath('data.metrics.tracked_today.note', 'of 7h target')
            ->assertJsonPath('data.focus', [])
            ->assertJsonPath('data.needs_attention', [])
            ->assertJsonPath('data.upcoming', [])
            ->assertJsonPath('data.activity', [])
            ->assertJsonPath('data.retainer', null)
            ->assertJsonPath('data.metrics.retainer_burn', null);
    }

    public function test_no_other_persons_work_reaches_any_list(): void
    {
        $mine = $this->makeTask('My overdue task', ['due_date' => '2026-08-10']);
        $this->makeTask('Their overdue task', [
            'due_date' => '2026-08-10',
            'assignee_user_id' => $this->other->id,
        ]);
        $this->makeTask('Their task due today', [
            'due_date' => '2026-08-12',
            'assignee_user_id' => $this->other->id,
        ]);
        $this->makeTask('Unassigned task due today', [
            'due_date' => '2026-08-12',
            'assignee_user_id' => null,
        ]);
        $this->makeTask('My finished task', [
            'due_date' => '2026-08-10',
            'status_value_id' => $this->statusId('complete'),
        ]);
        $this->makeTask('My archived task', ['due_date' => '2026-08-10', 'archived_at' => now()]);

        $response = $this->getJson('/api/dashboard')->assertOk();

        $this->assertSame([$mine->id], collect($response->json('data.focus'))->pluck('id')->all());
        $this->assertSame([$mine->id], collect($response->json('data.needs_attention'))->pluck('id')->all());
        $this->assertSame(0, $response->json('data.metrics.due_today.count'));
        $this->assertSame(1, $response->json('data.metrics.overdue.count'));
    }

    public function test_focus_puts_an_overdue_low_urgency_task_above_an_on_time_urgent_one(): void
    {
        $urgentToday = $this->makeTask('Urgent, due today', [
            'due_date' => '2026-08-12',
            'urgency_value_id' => $this->urgencyId('urgent'),
        ]);
        $overdueLow = $this->makeTask('Low, three days late', [
            'due_date' => '2026-08-09',
            'urgency_value_id' => $this->urgencyId('low'),
        ]);
        $normalToday = $this->makeTask('Normal, due today', ['due_date' => '2026-08-12']);
        $activeToday = $this->makeTask('Normal but in progress, due today', [
            'due_date' => '2026-08-12',
            'status_value_id' => $this->statusId('in_progress'),
        ]);

        $focus = collect($this->getJson('/api/dashboard')->assertOk()->json('data.focus'));

        $this->assertSame(
            [$overdueLow->id, $urgentToday->id, $activeToday->id, $normalToday->id],
            $focus->pluck('id')->all(),
        );
        $this->assertSame([1, 2, 3, 4], $focus->pluck('rank')->all());
        $this->assertTrue($focus->firstWhere('id', $overdueLow->id)['overdue']);
        $this->assertFalse($focus->firstWhere('id', $urgentToday->id)['overdue']);
        $this->assertSame('Website Relaunch', $focus->first()['project']);
        $this->assertSame('Northwind', $focus->first()['client']);
        $this->assertSame('active', $focus->firstWhere('id', $activeToday->id)['status']['role']);
        $this->assertSame(0, $focus->firstWhere('id', $urgentToday->id)['urgency']['rank']);
    }

    public function test_range_week_pulls_later_work_into_the_ranking_instead_of_padding(): void
    {
        $overdue = $this->makeTask('Late already', [
            'due_date' => '2026-08-11',
            'urgency_value_id' => $this->urgencyId('low'),
        ]);
        $lowSoon = $this->makeTask('Low, due in two days', [
            'due_date' => '2026-08-14',
            'urgency_value_id' => $this->urgencyId('low'),
        ]);
        $urgentLater = $this->makeTask('Urgent, due in three days', [
            'due_date' => '2026-08-15',
            'urgency_value_id' => $this->urgencyId('urgent'),
        ]);

        // Outside the scope, the two future tasks are only filler, so they keep
        // due-date order.
        $this->assertSame(
            [$overdue->id, $lowSoon->id, $urgentLater->id],
            collect($this->getJson('/api/dashboard')->assertOk()->json('data.focus'))->pluck('id')->all(),
        );

        // Inside it, urgency decides.
        $this->assertSame(
            [$overdue->id, $urgentLater->id, $lowSoon->id],
            collect($this->getJson('/api/dashboard?range=week')->assertOk()->json('data.focus'))->pluck('id')->all(),
        );
    }

    public function test_focus_is_capped_at_five(): void
    {
        for ($i = 1; $i <= 8; $i++) {
            $this->makeTask("Task {$i}", ['due_date' => '2026-08-12']);
        }

        $this->getJson('/api/dashboard')->assertOk()->assertJsonCount(5, 'data.focus');
    }

    public function test_metric_notes_count_the_unstarted_and_name_the_oldest_slip(): void
    {
        $this->makeTask('Due today, untouched', ['due_date' => '2026-08-12']);
        $this->makeTask('Due today, also untouched', ['due_date' => '2026-08-12']);
        $this->makeTask('Due today, under way', [
            'due_date' => '2026-08-12',
            'status_value_id' => $this->statusId('in_progress'),
        ]);
        $this->makeTask('Late by four days', ['due_date' => '2026-08-08']);
        $this->makeTask('Late by one day', ['due_date' => '2026-08-11']);

        $this->getJson('/api/dashboard')
            ->assertOk()
            ->assertJsonPath('data.metrics.due_today.count', 3)
            ->assertJsonPath('data.metrics.due_today.note', '2 not started')
            ->assertJsonPath('data.metrics.overdue.count', 2)
            ->assertJsonPath('data.metrics.overdue.note', 'oldest 4 days late');
    }

    public function test_metric_notes_are_empty_rather_than_invented_when_nothing_qualifies(): void
    {
        $this->makeTask('Due today, under way', [
            'due_date' => '2026-08-12',
            'status_value_id' => $this->statusId('in_progress'),
        ]);

        $this->getJson('/api/dashboard')
            ->assertOk()
            ->assertJsonPath('data.metrics.due_today.note', '')
            ->assertJsonPath('data.metrics.overdue.note', '');
    }

    public function test_needs_attention_names_a_reason_for_every_row(): void
    {
        $blocked = $this->makeTask('Waiting on brand assets', [
            'status_value_id' => $this->statusId('blocked'),
            'due_date' => '2026-08-20',
        ]);
        Task::query()->whereKey($blocked->id)->update(['updated_at' => '2026-08-09 08:00:00']);
        $late = $this->makeTask('Slipped last week', ['due_date' => '2026-08-08']);
        $notStarted = $this->makeTask('Due today, untouched', ['due_date' => '2026-08-12']);
        $this->makeTask('Due today, under way', [
            'due_date' => '2026-08-12',
            'status_value_id' => $this->statusId('in_progress'),
        ]);

        $rows = collect($this->getJson('/api/dashboard')->assertOk()->json('data.needs_attention'));

        $this->assertSame([$blocked->id, $late->id, $notStarted->id], $rows->pluck('id')->all());
        $this->assertSame(['blocked', 'overdue', 'not_started'], $rows->pluck('reason')->all());
        $this->assertSame([
            'Blocked for 3 days',
            '4 days late',
            'Due today, not started',
        ], $rows->pluck('why')->all());
        $this->assertSame('2026-08-08', $rows->firstWhere('reason', 'overdue')['due_date']);
        $this->assertSame('Website Relaunch', $rows->first()['project']);
    }

    public function test_needs_attention_is_capped_at_six(): void
    {
        for ($i = 1; $i <= 9; $i++) {
            $this->makeTask("Late task {$i}", ['due_date' => '2026-08-05']);
        }

        $this->getJson('/api/dashboard')->assertOk()->assertJsonCount(6, 'data.needs_attention');
    }

    public function test_upcoming_groups_by_day_and_labels_the_near_ones_in_words(): void
    {
        $today = $this->makeTask('Due today', ['due_date' => '2026-08-12']);
        $tomorrow = $this->makeTask('Due tomorrow', ['due_date' => '2026-08-13']);
        $saturday = $this->makeTask('Due Saturday', ['due_date' => '2026-08-15']);
        $this->makeTask('Due beyond the window', ['due_date' => '2026-08-27']);
        $this->makeTask('Already late', ['due_date' => '2026-08-11']);

        $upcoming = collect($this->getJson('/api/dashboard')->assertOk()->json('data.upcoming'));

        $this->assertSame(['2026-08-12', '2026-08-13', '2026-08-15'], $upcoming->pluck('date')->all());
        $this->assertSame(['Today', 'Tomorrow', 'Sat 15 Aug'], $upcoming->pluck('label')->all());
        $this->assertSame(
            [[$today->id], [$tomorrow->id], [$saturday->id]],
            $upcoming->map(fn (array $day) => array_column($day['tasks'], 'id'))->all(),
        );
    }

    public function test_the_week_is_always_seven_days_and_counts_a_timer_that_is_still_running(): void
    {
        $task = $this->makeTask('Tracked task');
        // Monday, closed.
        $this->entry($this->user, $task, '2026-08-10 09:00:00', '2026-08-10 12:00:00');
        $this->entry($this->user, $task, '2026-08-10 12:00:00', '2026-08-10 12:30:00', 'break');
        // Today, still running at 10:00.
        $this->entry($this->user, $task, '2026-08-12 09:00:00', null);
        // Last week, and somebody else's time, which must not appear.
        $this->entry($this->user, $task, '2026-08-05 09:00:00', '2026-08-05 11:00:00');
        $this->entry($this->other, $task, '2026-08-12 08:00:00', '2026-08-12 09:00:00');

        $response = $this->getJson('/api/dashboard')->assertOk();

        $response->assertJsonCount(7, 'data.week')
            ->assertJsonPath('data.week.0.date', '2026-08-10')
            ->assertJsonPath('data.week.0.label', 'Mon')
            ->assertJsonPath('data.week.0.work_minutes', 180)
            ->assertJsonPath('data.week.0.break_minutes', 30)
            ->assertJsonPath('data.week.0.is_today', false)
            ->assertJsonPath('data.week.2.date', '2026-08-12')
            ->assertJsonPath('data.week.2.is_today', true)
            ->assertJsonPath('data.week.2.work_minutes', 60)
            ->assertJsonPath('data.week.6.date', '2026-08-16')
            ->assertJsonPath('data.week_total_minutes', 240)
            ->assertJsonPath('data.last_week_total_minutes', 120)
            ->assertJsonPath('data.metrics.tracked_today.minutes', 60);
    }

    public function test_retainer_is_null_until_a_client_has_an_allowance(): void
    {
        $task = $this->makeTask('Tracked task');
        $this->entry($this->user, $task, '2026-08-03 09:00:00', '2026-08-03 13:00:00');

        $this->getJson('/api/dashboard')
            ->assertOk()
            ->assertJsonPath('data.retainer', null)
            ->assertJsonPath('data.metrics.retainer_burn', null);
    }

    public function test_retainer_burn_counts_everyones_time_and_projects_by_working_days(): void
    {
        $this->client->update(['retainer_minutes' => 4800]);
        $spare = Client::query()->create([
            'name' => 'No retainer here',
            'created_by' => $this->user->id,
            'retainer_minutes' => null,
        ]);
        $spareProject = Project::query()->create([
            'client_id' => $spare->id,
            'name' => 'Unfunded work',
            'created_by' => $this->user->id,
        ]);

        $task = $this->makeTask('Tracked task');
        // Anyone's work against the client counts, not only the requester's.
        $this->entry($this->other, $task, '2026-08-03 09:00:00', '2026-08-03 13:00:00');
        $this->entry($this->user, $task, '2026-08-12 09:00:00', '2026-08-12 10:00:00');
        // A break never burns the allowance, and neither does last month.
        $this->entry($this->user, $task, '2026-08-12 08:00:00', '2026-08-12 08:30:00', 'break');
        $this->entry($this->user, $task, '2026-07-30 09:00:00', '2026-07-30 17:00:00');
        // A client with no allowance stays out of it entirely.
        $unfunded = $this->makeTask('Unfunded task', ['project_id' => $spareProject->id]);
        $this->entry($this->user, $unfunded, '2026-08-04 09:00:00', '2026-08-04 17:00:00');

        $response = $this->getJson('/api/dashboard')->assertOk();

        $response->assertJsonPath('data.retainer.month_label', 'August')
            ->assertJsonPath('data.retainer.capacity_minutes', 4800)
            ->assertJsonPath('data.retainer.used_minutes', 300)
            ->assertJsonPath('data.retainer.day_of_month', 12)
            ->assertJsonPath('data.retainer.days_in_month', 31)
            // 8 weekdays elapsed of the month's 21: 300 * 21 / 8.
            ->assertJsonPath('data.retainer.projected_minutes', 788)
            ->assertJsonPath('data.metrics.retainer_burn.percent', 6)
            ->assertJsonPath('data.metrics.retainer_burn.note', 'across 1 client');

        $series = collect($response->json('data.retainer.series'));
        $this->assertCount(12, $series);
        $this->assertSame(0, $series->firstWhere('day', 1)['used_minutes']);
        $this->assertSame(240, $series->firstWhere('day', 3)['used_minutes']);
        // Cumulative, so the 4th holds the 3rd's total even with nothing logged.
        $this->assertSame(240, $series->firstWhere('day', 4)['used_minutes']);
        $this->assertSame(300, $series->firstWhere('day', 12)['used_minutes']);

        $this->assertSame(
            [['id' => $this->client->id, 'name' => 'Northwind', 'used_minutes' => 300, 'retainer_minutes' => 4800]],
            $response->json('data.retainer.clients'),
        );
    }

    public function test_retainer_clients_are_ordered_by_how_much_of_the_allowance_is_gone(): void
    {
        $this->client->update(['retainer_minutes' => 4800]);
        $small = Client::query()->create([
            'name' => 'Bluepeak',
            'created_by' => $this->user->id,
            'retainer_minutes' => 600,
        ]);
        $smallProject = Project::query()->create([
            'client_id' => $small->id,
            'name' => 'Brand refresh',
            'created_by' => $this->user->id,
        ]);

        $this->entry($this->user, $this->makeTask('Big client task'), '2026-08-03 09:00:00', '2026-08-03 13:00:00');
        $this->entry(
            $this->user,
            $this->makeTask('Small client task', ['project_id' => $smallProject->id]),
            '2026-08-04 09:00:00',
            '2026-08-04 12:00:00',
        );

        $clients = collect($this->getJson('/api/dashboard')->assertOk()->json('data.retainer.clients'));

        // 180 of 600 beats 240 of 4800.
        $this->assertSame(['Bluepeak', 'Northwind'], $clients->pluck('name')->all());
        $this->assertSame(5400, (int) $this->getJson('/api/dashboard')->json('data.retainer.capacity_minutes'));
    }

    public function test_activity_reports_what_other_people_did_to_my_tasks(): void
    {
        $mine = $this->makeTask('Ship the ad creatives');
        $theirs = $this->makeTask('Their own task', [
            'assignee_user_id' => $this->other->id,
            'created_by' => $this->other->id,
        ]);

        $log = $this->auditLog($this->other, 'task.note.create', $mine);
        $this->auditLog($this->user, 'task.update', $mine);
        $this->auditLog($this->other, 'task.update', $theirs);

        $activity = collect($this->getJson('/api/dashboard')->assertOk()->json('data.activity'));

        $this->assertSame([$log->id], $activity->pluck('id')->all());
        $this->assertSame('Liam commented on Ship the ad creatives', $activity->first()['text']);
        $this->assertSame(
            ['id' => $this->other->id, 'first_name' => 'Liam', 'last_name' => 'Cruz'],
            $activity->first()['user'],
        );
        $this->assertStringStartsWith('2026-08-12T', $activity->first()['at']);
    }

    public function test_the_dashboard_still_needs_its_permission(): void
    {
        Sanctum::actingAs($this->other);

        $this->getJson('/api/dashboard')->assertForbidden();
    }

    private function makeTask(string $title, array $overrides = []): Task
    {
        return Task::query()->create(array_merge([
            'project_id' => $this->project->id,
            'title' => $title,
            'status_value_id' => $this->statusId('pending'),
            'urgency_value_id' => $this->urgencyId('normal'),
            'assignee_user_id' => $this->user->id,
            'actual_minutes' => 0,
            'created_by' => $this->user->id,
        ], $overrides));
    }

    private function entry(User $user, Task $task, string $startedAt, ?string $endedAt, string $kind = 'work'): TimeEntry
    {
        return TimeEntry::query()->create([
            'user_id' => $user->id,
            'task_id' => $task->id,
            'kind' => $kind,
            'started_at' => Carbon::parse($startedAt),
            'ended_at' => $endedAt ? Carbon::parse($endedAt) : null,
        ]);
    }

    private function auditLog(User $actor, string $action, Task $task): AuditLog
    {
        return AuditLog::query()->create([
            'user_id' => $actor->id,
            'action' => $action,
            'entity_type' => 'Task',
            'entity_id' => $task->id,
            'summary' => $action,
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
