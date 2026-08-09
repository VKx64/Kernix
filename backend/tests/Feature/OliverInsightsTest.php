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
 * Oliver's read-only half. Every figure has to belong to the person asking, so
 * these tests are mostly about scope, and about the retainer agreeing with the
 * dashboard rather than quietly computing its own version of the month.
 */
class OliverInsightsTest extends TestCase
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

    public function test_an_empty_workspace_answers_with_empty_lists_rather_than_nulls(): void
    {
        $response = $this->getJson('/api/oliver/insights')->assertOk();

        $response->assertJsonPath('data.watching', ['projects' => 0, 'tasks' => 0, 'clients' => 0])
            ->assertJsonPath('data.risk', [])
            ->assertJsonPath('data.retainer', [])
            ->assertJsonPath('data.time_gaps', [])
            ->assertJsonPath('data.workload.open', 0)
            ->assertJsonPath('data.workload.overdue', 0)
            ->assertJsonPath('data.workload.tracked_week_minutes', 0)
            ->assertJsonPath('data.workload.target_week_minutes', 2100)
            ->assertJsonPath('data.workload.committed_minutes', 0)
            ->assertJsonPath('data.workload.over_committed', false);
    }

    public function test_insights_need_the_same_permission_as_the_rest_of_oliver(): void
    {
        Sanctum::actingAs($this->other);

        $this->getJson('/api/oliver/insights')->assertForbidden();
    }

    public function test_watching_counts_only_the_requesters_own_open_work(): void
    {
        $second = Project::query()->create([
            'client_id' => Client::query()->create(['name' => 'Bluepeak', 'created_by' => $this->user->id])->id,
            'name' => 'Brand refresh',
            'created_by' => $this->user->id,
        ]);
        $this->makeTask('Mine one');
        $this->makeTask('Mine two', ['project_id' => $second->id]);
        $this->makeTask('Theirs', ['assignee_user_id' => $this->other->id]);
        $this->makeTask('Mine but finished', ['status_value_id' => $this->statusId('complete')]);
        $this->makeTask('Mine but archived', ['archived_at' => now()]);

        $this->getJson('/api/oliver/insights')
            ->assertOk()
            ->assertJsonPath('data.watching', ['projects' => 2, 'tasks' => 2, 'clients' => 2]);
    }

    public function test_risk_names_a_reason_and_a_severity_for_every_row_worst_first(): void
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
        $this->makeTask('Somebody else is late', [
            'due_date' => '2026-08-01',
            'assignee_user_id' => $this->other->id,
        ]);

        $risk = collect($this->getJson('/api/oliver/insights')->assertOk()->json('data.risk'));

        $this->assertSame([$blocked->id, $late->id, $notStarted->id], $risk->pluck('task_id')->all());
        $this->assertSame(['blocked', 'overdue', 'not_started'], $risk->pluck('reason')->all());
        $this->assertSame(['high', 'high', 'medium'], $risk->pluck('severity')->all());
        $this->assertSame([
            'Blocked for 3 days',
            '4 days late',
            'Due today, not started',
        ], $risk->pluck('why')->all());
        $this->assertSame('Waiting on brand assets', $risk->first()['title']);
    }

    public function test_workload_counts_the_plate_the_week_and_the_next_seven_days(): void
    {
        $this->makeTask('Late one', ['due_date' => '2026-08-10', 'estimated_minutes' => 120]);
        $this->makeTask('Due Thursday', ['due_date' => '2026-08-13', 'estimated_minutes' => 900]);
        $this->makeTask('Due next Monday', ['due_date' => '2026-08-17', 'estimated_minutes' => 1500]);
        // Outside the seven-day window, so it is not committed capacity yet.
        $this->makeTask('Due in a fortnight', ['due_date' => '2026-08-26', 'estimated_minutes' => 3000]);
        // Somebody else's plate never lands on this one.
        $this->makeTask('Theirs', [
            'due_date' => '2026-08-13',
            'estimated_minutes' => 5000,
            'assignee_user_id' => $this->other->id,
        ]);

        $tracked = $this->makeTask('Tracked task');
        $this->entry($this->user, $tracked, '2026-08-10 09:00:00', '2026-08-10 12:00:00');
        $this->entry($this->user, $tracked, '2026-08-12 09:00:00', null);
        $this->entry($this->user, $tracked, '2026-08-12 08:00:00', '2026-08-12 08:30:00', 'break');
        $this->entry($this->user, $tracked, '2026-08-05 09:00:00', '2026-08-05 17:00:00');
        $this->entry($this->other, $tracked, '2026-08-11 09:00:00', '2026-08-11 17:00:00');

        $this->getJson('/api/oliver/insights')
            ->assertOk()
            ->assertJsonPath('data.workload.open', 5)
            ->assertJsonPath('data.workload.overdue', 1)
            // Monday's three hours plus a timer still running since 09:00 today.
            ->assertJsonPath('data.workload.tracked_week_minutes', 240)
            ->assertJsonPath('data.workload.target_week_minutes', 2100)
            ->assertJsonPath('data.workload.committed_minutes', 2400)
            // Five working days left in the window carry 2100 minutes of target.
            ->assertJsonPath('data.workload.over_committed', true);
    }

    public function test_a_lighter_week_is_not_reported_as_over_committed(): void
    {
        $this->makeTask('Due Thursday', ['due_date' => '2026-08-13', 'estimated_minutes' => 600]);

        $this->getJson('/api/oliver/insights')
            ->assertOk()
            ->assertJsonPath('data.workload.committed_minutes', 600)
            ->assertJsonPath('data.workload.over_committed', false);
    }

    public function test_retainer_reports_the_same_burn_the_dashboard_does(): void
    {
        $this->client->update(['retainer_minutes' => 4800]);
        $spare = Client::query()->create(['name' => 'No retainer here', 'created_by' => $this->user->id]);
        $spareProject = Project::query()->create([
            'client_id' => $spare->id,
            'name' => 'Unfunded work',
            'created_by' => $this->user->id,
        ]);

        $task = $this->makeTask('Tracked task');
        // Anyone's work against the client burns the allowance, not only mine.
        $this->entry($this->other, $task, '2026-08-03 09:00:00', '2026-08-03 13:00:00');
        $this->entry($this->user, $task, '2026-08-12 09:00:00', '2026-08-12 10:00:00');
        $this->entry($this->user, $task, '2026-07-30 09:00:00', '2026-07-30 17:00:00');
        $this->entry($this->user, $this->makeTask('Unfunded task', ['project_id' => $spareProject->id]), '2026-08-04 09:00:00', '2026-08-04 17:00:00');

        $retainer = $this->getJson('/api/oliver/insights')->assertOk()->json('data.retainer');
        $dashboard = $this->getJson('/api/dashboard')->assertOk()->json('data.retainer');

        $this->assertCount(1, $retainer);
        $this->assertSame($this->client->id, $retainer[0]['client_id']);
        $this->assertSame('Northwind', $retainer[0]['name']);
        $this->assertSame(4800, $retainer[0]['retainer_minutes']);
        $this->assertSame(6, $retainer[0]['percent']);
        // 8 weekdays elapsed of the month's 21: 300 * 21 / 8.
        $this->assertSame(788, $retainer[0]['projected_minutes']);
        $this->assertFalse($retainer[0]['over']);

        $this->assertSame($dashboard['clients'][0]['used_minutes'], $retainer[0]['used_minutes']);
        $this->assertSame($dashboard['used_minutes'], $retainer[0]['used_minutes']);
        $this->assertSame($dashboard['projected_minutes'], $retainer[0]['projected_minutes']);
    }

    public function test_a_client_heading_past_its_allowance_is_flagged(): void
    {
        $this->client->update(['retainer_minutes' => 600]);
        $task = $this->makeTask('Tracked task');
        $this->entry($this->user, $task, '2026-08-03 09:00:00', '2026-08-03 17:00:00');

        $retainer = $this->getJson('/api/oliver/insights')->assertOk()->json('data.retainer');

        $this->assertSame(480, $retainer[0]['used_minutes']);
        $this->assertSame(80, $retainer[0]['percent']);
        $this->assertSame(1260, $retainer[0]['projected_minutes']);
        $this->assertTrue($retainer[0]['over']);
    }

    public function test_time_gaps_name_the_requesters_own_thin_days_only(): void
    {
        $task = $this->makeTask('Tracked task');
        // Friday: touched a task, tracked 90 minutes of a 420 minute day.
        $this->entry($this->user, $task, '2026-08-07 09:00:00', '2026-08-07 10:30:00');
        $this->touched($this->user, $task, '2026-08-07 11:00:00');
        // Tuesday: touched a task and tracked a full day, so nothing to say.
        $this->entry($this->user, $task, '2026-08-11 09:00:00', '2026-08-11 17:00:00');
        $this->touched($this->user, $task, '2026-08-11 11:00:00');
        // Monday: nothing tracked, but nothing touched either. Not a gap.
        // Wednesday last week: somebody else's thin day is none of my business.
        $this->touched($this->other, $task, '2026-08-05 11:00:00');

        $gaps = $this->getJson('/api/oliver/insights')->assertOk()->json('data.time_gaps');

        $this->assertSame([[
            'date' => '2026-08-07',
            'tracked_minutes' => 90,
            'target_minutes' => 420,
            'note' => 'Friday has 5h 30m unaccounted for',
        ]], $gaps);
    }

    /** @param array<string, mixed> $overrides */
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

    private function touched(User $user, Task $task, string $at): AuditLog
    {
        $log = AuditLog::query()->create([
            'user_id' => $user->id,
            'action' => 'task.update',
            'entity_type' => 'Task',
            'entity_id' => $task->id,
            'summary' => 'task.update',
        ]);
        AuditLog::query()->whereKey($log->id)->update(['created_at' => Carbon::parse($at)]);

        return $log;
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
