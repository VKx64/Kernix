<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Project;
use App\Models\Role;
use App\Models\Task;
use App\Models\TimeEntry;
use App\Models\TimesheetDescription;
use App\Models\User;
use App\Support\TaskStatuses;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The payroll timesheet. One row per task per local day, grouped by client,
 * hours to two decimals so every number traces back to a closed work entry.
 */
class TimesheetApiTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    private User $colleague;

    private User $admin;

    private Client $client;

    private Task $task;

    private int $roleSequence = 0;

    protected function setUp(): void
    {
        parent::setUp();

        TaskStatuses::flush();
        $this->seed();
        $this->admin = User::query()->findOrFail(1);
        $this->user = $this->tracker();
        $this->colleague = $this->tracker();

        $this->client = Client::query()->create(['name' => 'Northwind Creative', 'created_by' => $this->admin->id]);
        $this->task = $this->taskFor($this->client, 'Fix broken checkout links');

        Sanctum::actingAs($this->user);
        $this->travelTo(Carbon::parse('2026-08-09 12:00:00'));
    }

    public function test_two_sittings_on_one_task_in_one_day_become_a_single_row(): void
    {
        $this->work($this->user, $this->task, '2026-08-03 09:00:00', '2026-08-03 10:00:00');
        $this->work($this->user, $this->task, '2026-08-03 13:00:00', '2026-08-03 13:35:00');

        $response = $this->getJson('/api/timesheet')->assertOk();

        $response->assertJsonCount(1, 'data.lanes')
            ->assertJsonCount(1, 'data.lanes.0.rows')
            ->assertJsonPath('data.lanes.0.client', 'Northwind Creative')
            ->assertJsonPath('data.lanes.0.client_id', $this->client->id)
            ->assertJsonPath('data.lanes.0.rows.0.date', '2026-08-03')
            ->assertJsonPath('data.lanes.0.rows.0.minutes', 95)
            ->assertJsonPath('data.entry_count', 1)
            ->assertJsonPath('data.days_worked', 1)
            ->assertJsonPath('data.total_minutes', 95);

        $this->assertSame(1.58, (float) $response->json('data.lanes.0.rows.0.hours'));
    }

    public function test_the_same_task_on_two_days_is_two_rows(): void
    {
        $this->work($this->user, $this->task, '2026-08-04 09:00:00', '2026-08-04 09:37:00');
        $this->work($this->user, $this->task, '2026-08-03 09:00:00', '2026-08-03 10:00:00');

        $response = $this->getJson('/api/timesheet')->assertOk()
            ->assertJsonCount(2, 'data.lanes.0.rows')
            ->assertJsonPath('data.entry_count', 2)
            ->assertJsonPath('data.days_worked', 2)
            // Rows read in date order, not insertion order.
            ->assertJsonPath('data.lanes.0.rows.0.date', '2026-08-03')
            ->assertJsonPath('data.lanes.0.rows.1.date', '2026-08-04')
            ->assertJsonPath('data.lanes.0.rows.1.minutes', 37)
            ->assertJsonPath('data.total_minutes', 97);

        $this->assertSame(0.62, (float) $response->json('data.lanes.0.rows.1.hours'));
    }

    public function test_only_the_requesting_users_time_appears(): void
    {
        $this->work($this->user, $this->task, '2026-08-03 09:00:00', '2026-08-03 10:00:00');
        $this->work($this->colleague, $this->task, '2026-08-03 10:00:00', '2026-08-03 16:00:00');

        $this->getJson('/api/timesheet')->assertOk()
            ->assertJsonCount(1, 'data.lanes.0.rows')
            ->assertJsonPath('data.total_minutes', 60);
    }

    public function test_a_running_entry_is_not_a_timesheet_row(): void
    {
        TimeEntry::query()->create([
            'user_id' => $this->user->id,
            'task_id' => $this->task->id,
            'kind' => 'work',
            'started_at' => Carbon::parse('2026-08-09 09:00:00'),
        ]);
        // Breaks are not work, however long they ran.
        TimeEntry::query()->create([
            'user_id' => $this->user->id,
            'task_id' => $this->task->id,
            'kind' => 'break',
            'break_kind' => 'Lunch',
            'started_at' => Carbon::parse('2026-08-08 12:00:00'),
            'ended_at' => Carbon::parse('2026-08-08 13:00:00'),
        ]);

        $this->getJson('/api/timesheet')->assertOk()
            ->assertJsonPath('data.lanes', [])
            ->assertJsonPath('data.total_minutes', 0)
            ->assertJsonPath('data.entry_count', 0)
            ->assertJsonPath('data.days_worked', 0);
    }

    public function test_the_semi_monthly_period_splits_at_the_fifteenth(): void
    {
        $this->work($this->user, $this->task, '2026-08-15 09:00:00', '2026-08-15 10:00:00');
        $this->work($this->user, $this->task, '2026-08-16 09:00:00', '2026-08-16 11:00:00');

        // Today is the 9th, so the first half of August is the current period.
        $this->getJson('/api/timesheet')->assertOk()
            ->assertJsonPath('data.period.start', '2026-08-01')
            ->assertJsonPath('data.period.end', '2026-08-15')
            ->assertJsonPath('data.period.label', 'Aug 1 – 15, 2026')
            ->assertJsonPath('data.total_minutes', 60);

        $this->getJson('/api/timesheet?offset=1')->assertOk()
            ->assertJsonPath('data.period.start', '2026-08-16')
            ->assertJsonPath('data.period.end', '2026-08-31')
            ->assertJsonPath('data.period.label', 'Aug 16 – 31, 2026')
            ->assertJsonPath('data.total_minutes', 120);

        // From the second half, one period back is the first half of the month.
        $this->travelTo(Carbon::parse('2026-08-20 12:00:00'));
        $this->getJson('/api/timesheet?offset=-1')->assertOk()
            ->assertJsonPath('data.period.start', '2026-08-01')
            ->assertJsonPath('data.period.end', '2026-08-15')
            ->assertJsonPath('data.total_minutes', 60);
    }

    public function test_the_offset_walks_backwards_across_a_month_boundary(): void
    {
        $this->work($this->user, $this->task, '2026-07-20 09:00:00', '2026-07-20 10:00:00');
        $this->work($this->user, $this->task, '2026-01-05 09:00:00', '2026-01-05 10:30:00');

        // Aug 1-15 back two periods is Jul 1-15; back three is Jun 16-30.
        $this->getJson('/api/timesheet?offset=-1')->assertOk()
            ->assertJsonPath('data.period.start', '2026-07-16')
            ->assertJsonPath('data.period.end', '2026-07-31')
            ->assertJsonPath('data.period.label', 'Jul 16 – 31, 2026')
            ->assertJsonPath('data.total_minutes', 60);

        $this->getJson('/api/timesheet?offset=-3')->assertOk()
            ->assertJsonPath('data.period.start', '2026-06-16')
            ->assertJsonPath('data.period.end', '2026-06-30');

        // And across the year: Aug 1-15 back fifteen periods is Jan 1-15.
        $this->getJson('/api/timesheet?offset=-14')->assertOk()
            ->assertJsonPath('data.period.start', '2026-01-01')
            ->assertJsonPath('data.period.end', '2026-01-15')
            ->assertJsonPath('data.total_minutes', 90);
    }

    public function test_the_monthly_cutoff_covers_the_whole_calendar_month(): void
    {
        $this->work($this->user, $this->task, '2026-08-03 09:00:00', '2026-08-03 10:00:00');
        $this->work($this->user, $this->task, '2026-08-20 09:00:00', '2026-08-20 10:00:00');

        $this->getJson('/api/timesheet?cutoff=month')->assertOk()
            ->assertJsonPath('data.cutoff', 'month')
            ->assertJsonPath('data.period.start', '2026-08-01')
            ->assertJsonPath('data.period.end', '2026-08-31')
            ->assertJsonPath('data.period.label', 'August 2026')
            ->assertJsonPath('data.total_minutes', 120);

        $this->getJson('/api/timesheet?cutoff=month&offset=-1')->assertOk()
            ->assertJsonPath('data.period.start', '2026-07-01')
            ->assertJsonPath('data.period.end', '2026-07-31')
            ->assertJsonPath('data.period.label', 'July 2026')
            ->assertJsonPath('data.total_minutes', 0);
    }

    public function test_descriptions_are_generated_from_the_task_title_in_past_tense(): void
    {
        $this->work($this->user, $this->task, '2026-08-03 09:00:00', '2026-08-03 10:00:00');

        $this->getJson('/api/timesheet')->assertOk()
            ->assertJsonPath('data.lanes.0.rows.0.generated', 'Fixed broken checkout links')
            ->assertJsonPath('data.lanes.0.rows.0.description', 'Fixed broken checkout links')
            ->assertJsonPath('data.lanes.0.rows.0.task_title', 'Fix broken checkout links')
            ->assertJsonPath('data.lanes.0.rows.0.edited', false);
    }

    public function test_a_title_loses_its_aside_and_keeps_an_unknown_verb_as_written(): void
    {
        $aside = $this->taskFor($this->client, 'Rewrite the onboarding copy — blocked on legal.');
        $unknown = $this->taskFor($this->client, 'Wrangle the staging queue');
        $this->work($this->user, $aside, '2026-08-03 09:00:00', '2026-08-03 10:00:00');
        $this->work($this->user, $unknown, '2026-08-03 10:00:00', '2026-08-03 11:00:00');

        $rows = collect($this->getJson('/api/timesheet')->assertOk()->json('data.lanes.0.rows'))
            ->pluck('generated')
            ->all();

        $this->assertContains('Rewrote the onboarding copy', $rows);
        $this->assertContains('Wrangle the staging queue', $rows);
    }

    public function test_an_override_wins_over_the_generated_text_and_posting_it_back_clears_it(): void
    {
        $this->work($this->user, $this->task, '2026-08-03 09:00:00', '2026-08-03 10:00:00');

        $this->putJson('/api/timesheet/description', [
            'task_id' => $this->task->id,
            'date' => '2026-08-03',
            'body' => '  Chased the payment gateway timeouts  ',
        ])->assertOk()
            ->assertJsonPath('data.task_id', $this->task->id)
            ->assertJsonPath('data.date', '2026-08-03')
            ->assertJsonPath('data.description', 'Chased the payment gateway timeouts')
            ->assertJsonPath('data.generated', 'Fixed broken checkout links')
            ->assertJsonPath('data.edited', true)
            ->assertJsonPath('data.minutes', 60);

        $this->getJson('/api/timesheet')->assertOk()
            ->assertJsonPath('data.lanes.0.rows.0.description', 'Chased the payment gateway timeouts')
            ->assertJsonPath('data.lanes.0.rows.0.edited', true);

        $this->assertSame(1, TimesheetDescription::query()->count());

        // Agreeing with the generated line stores nothing.
        $this->putJson('/api/timesheet/description', [
            'task_id' => $this->task->id,
            'date' => '2026-08-03',
            'body' => 'Fixed broken checkout links',
        ])->assertOk()
            ->assertJsonPath('data.description', 'Fixed broken checkout links')
            ->assertJsonPath('data.edited', false);

        $this->assertSame(0, TimesheetDescription::query()->count());
    }

    public function test_a_description_needs_time_tracked_on_that_task_that_day(): void
    {
        $this->work($this->user, $this->task, '2026-08-03 09:00:00', '2026-08-03 10:00:00');

        $this->putJson('/api/timesheet/description', [
            'task_id' => $this->task->id,
            'date' => '2026-08-04',
            'body' => 'Work I did not do',
        ])->assertStatus(422)
            ->assertJsonPath('message', 'You have no tracked time on that task for that date.');

        $other = $this->taskFor($this->client, 'Ship the invoice reminder');
        $this->putJson('/api/timesheet/description', [
            'task_id' => $other->id,
            'date' => '2026-08-03',
            'body' => 'Work I did not do',
        ])->assertStatus(422);

        // Someone else's time on the task is not the requester's to describe.
        $this->work($this->colleague, $other, '2026-08-03 09:00:00', '2026-08-03 10:00:00');
        $this->putJson('/api/timesheet/description', [
            'task_id' => $other->id,
            'date' => '2026-08-03',
            'body' => 'Work I did not do',
        ])->assertStatus(422);

        $this->putJson('/api/timesheet/description', [
            'task_id' => $this->task->id,
            'date' => '2026-08-03',
            'body' => '   ',
        ])->assertStatus(422)->assertJsonValidationErrors('body');
    }

    public function test_a_task_with_no_client_lands_in_the_no_client_lane_sorted_last(): void
    {
        // A project the workspace has since deleted: the time survives, the
        // client it belonged to no longer resolves.
        $orphan = $this->taskFor($this->client, 'Run the weekly backup drill');
        Project::query()->whereKey($orphan->project_id)->delete();
        $quiet = Client::query()->create(['name' => 'Alpine Foods', 'created_by' => $this->admin->id]);
        $quietTask = $this->taskFor($quiet, 'Draft the launch email');

        // The orphan carries the most time and still sorts last.
        $this->work($this->user, $orphan, '2026-08-03 09:00:00', '2026-08-03 15:00:00');
        $this->work($this->user, $this->task, '2026-08-03 15:00:00', '2026-08-03 17:00:00');
        $this->work($this->user, $quietTask, '2026-08-04 09:00:00', '2026-08-04 09:30:00');

        $this->getJson('/api/timesheet')->assertOk()
            ->assertJsonCount(3, 'data.lanes')
            ->assertJsonPath('data.lanes.0.client', 'Northwind Creative')
            ->assertJsonPath('data.lanes.0.minutes', 120)
            ->assertJsonPath('data.lanes.1.client', 'Alpine Foods')
            ->assertJsonPath('data.lanes.2.client', 'No client')
            ->assertJsonPath('data.lanes.2.client_id', null)
            ->assertJsonPath('data.lanes.2.minutes', 360)
            ->assertJsonPath('data.lanes.2.rows.0.generated', 'Ran the weekly backup drill')
            ->assertJsonPath('data.entry_count', 3)
            ->assertJsonPath('data.days_worked', 2)
            ->assertJsonPath('data.total_minutes', 510);
    }

    public function test_untargeted_time_is_reported_apart_from_the_lanes(): void
    {
        $this->work($this->user, null, '2026-08-03 09:00:00', '2026-08-03 09:45:00');
        $this->work($this->user, $this->task, '2026-08-03 10:00:00', '2026-08-03 11:00:00');

        $this->getJson('/api/timesheet')->assertOk()
            ->assertJsonCount(1, 'data.lanes')
            ->assertJsonPath('data.unassigned_minutes', 45)
            ->assertJsonPath('data.total_minutes', 60)
            ->assertJsonPath('data.entry_count', 1);
    }

    public function test_an_entry_crossing_midnight_is_split_between_the_two_days(): void
    {
        $this->work($this->user, $this->task, '2026-08-03 22:30:00', '2026-08-04 01:00:00');

        $this->getJson('/api/timesheet')->assertOk()
            ->assertJsonCount(2, 'data.lanes.0.rows')
            ->assertJsonPath('data.lanes.0.rows.0.minutes', 90)
            ->assertJsonPath('data.lanes.0.rows.1.minutes', 60);
    }

    public function test_the_timesheet_needs_the_time_track_permission(): void
    {
        Sanctum::actingAs(User::factory()->create(['role_id' => $this->roleFor([])->id]));

        $this->getJson('/api/timesheet')->assertStatus(403);
        $this->putJson('/api/timesheet/description', [
            'task_id' => $this->task->id,
            'date' => '2026-08-03',
            'body' => 'Nope',
        ])->assertStatus(403);
    }

    private function work(User $user, ?Task $task, string $from, string $to): TimeEntry
    {
        return TimeEntry::query()->create([
            'user_id' => $user->id,
            'task_id' => $task?->id,
            'kind' => 'work',
            'started_at' => Carbon::parse($from),
            'ended_at' => Carbon::parse($to),
        ]);
    }

    private function taskFor(Client $client, string $title): Task
    {
        $project = Project::query()->create([
            'client_id' => $client->id,
            'name' => $client->name.' retainer',
            'created_by' => $this->admin->id,
        ]);

        return Task::query()->create([
            'project_id' => $project->id,
            'title' => $title,
            'status_value_id' => TaskStatuses::id('in_progress'),
            'actual_minutes' => 0,
            'assignee_user_id' => $this->user->id,
            'created_by' => $this->admin->id,
        ]);
    }

    private function tracker(): User
    {
        return User::factory()->create(['role_id' => $this->roleFor(['time.track'])->id]);
    }

    /** @param array<int, string> $permissions */
    private function roleFor(array $permissions): Role
    {
        $this->roleSequence++;
        $role = Role::query()->create([
            'name' => "Timesheet role {$this->roleSequence}",
            'key_name' => "timesheet_{$this->roleSequence}",
        ]);
        $keys = array_values(array_unique(['dashboard.view', 'tasks.view', ...$permissions]));
        $role->permissions()->createMany(array_map(
            fn (string $key) => ['permission_key' => $key],
            $keys,
        ));

        return $role;
    }
}
