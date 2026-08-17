<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Project;
use App\Models\Role;
use App\Models\Task;
use App\Models\TaskNote;
use App\Models\TimeEntry;
use App\Models\User;
use App\Support\TaskStatuses;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The timesheet used to answer only one question — what did a timer watch —
 * which left anybody who finishes a job in one sitting and marks it done with
 * an empty sheet and no way to tell why.
 *
 * It now answers the question people actually ask it: what did I get done in
 * this period, and how long did each of them take. Work with no time against
 * it appears with its hours blank, for the person to fill in. Nothing here
 * invents an hour.
 */
class TimesheetFinishedWorkTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    private User $colleague;

    private User $admin;

    private Client $client;

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

        Sanctum::actingAs($this->user);
        $this->travelTo(Carbon::parse('2026-08-09 12:00:00'));
    }

    public function test_a_task_finished_with_no_time_still_gets_a_row_with_blank_hours(): void
    {
        $task = $this->taskFor('Fix broken checkout links');
        $this->finish($task, '2026-08-05 16:00:00');

        $row = $this->firstRow();

        $this->assertSame('2026-08-05', $row['date']);
        $this->assertSame('Fixed broken checkout links', $row['description']);
        $this->assertNull($row['minutes']);
        $this->assertNull($row['hours']);
        $this->assertTrue($row['needs_hours']);
    }

    public function test_blank_hours_count_as_nothing_until_somebody_types_them(): void
    {
        $task = $this->taskFor('Fix broken checkout links');
        $this->finish($task, '2026-08-05 16:00:00');

        $this->getJson('/api/timesheet')->assertOk()->assertJsonPath('data.total_minutes', 0);

        $this->putJson('/api/timesheet/hours', [
            'task_id' => $task->id,
            'date' => '2026-08-05',
            'minutes' => 150,
        ])->assertOk()
            ->assertJsonPath('data.minutes', 150)
            ->assertJsonPath('data.hours', 2.5)
            ->assertJsonPath('data.needs_hours', false)
            ->assertJsonPath('data.typed', true);

        $this->getJson('/api/timesheet')->assertOk()->assertJsonPath('data.total_minutes', 150);
    }

    public function test_clearing_typed_hours_puts_the_row_back_to_blank(): void
    {
        $task = $this->taskFor('Fix broken checkout links');
        $this->finish($task, '2026-08-05 16:00:00');

        $this->putJson('/api/timesheet/hours', ['task_id' => $task->id, 'date' => '2026-08-05', 'minutes' => 60])
            ->assertOk();
        $this->putJson('/api/timesheet/hours', ['task_id' => $task->id, 'date' => '2026-08-05', 'minutes' => null])
            ->assertOk()
            ->assertJsonPath('data.minutes', null)
            ->assertJsonPath('data.needs_hours', true);

        // Zero is a person saying the job took no billable time, and has to
        // survive as a number rather than reading as "nothing typed yet".
        $this->putJson('/api/timesheet/hours', ['task_id' => $task->id, 'date' => '2026-08-05', 'minutes' => 0])
            ->assertOk()
            ->assertJsonPath('data.minutes', 0)
            ->assertJsonPath('data.needs_hours', false);
    }

    public function test_a_description_survives_the_hours_being_edited_and_the_other_way_round(): void
    {
        $task = $this->taskFor('Fix broken checkout links');
        $this->finish($task, '2026-08-05 16:00:00');

        $this->putJson('/api/timesheet/description', [
            'task_id' => $task->id,
            'date' => '2026-08-05',
            'body' => 'Rebuilt the checkout links and retested the basket',
        ])->assertOk();

        $this->putJson('/api/timesheet/hours', ['task_id' => $task->id, 'date' => '2026-08-05', 'minutes' => 90])
            ->assertOk()
            ->assertJsonPath('data.description', 'Rebuilt the checkout links and retested the basket')
            ->assertJsonPath('data.minutes', 90);

        $this->putJson('/api/timesheet/description', [
            'task_id' => $task->id,
            'date' => '2026-08-05',
            'body' => 'Rebuilt the checkout links',
        ])->assertOk()
            ->assertJsonPath('data.minutes', 90);
    }

    public function test_minutes_logged_by_hand_reach_the_timesheet(): void
    {
        $task = $this->taskFor('Fix broken checkout links');
        TaskNote::query()->create([
            'task_id' => $task->id,
            'body' => 'Traced it to the redirect rule.',
            'time_minutes' => 45,
            'time_logged_by' => $this->user->id,
            'created_by' => $this->user->id,
            'created_at' => Carbon::parse('2026-08-04 11:00:00'),
        ]);

        $row = $this->firstRow();

        $this->assertSame('2026-08-04', $row['date']);
        $this->assertSame(45, $row['minutes']);
        $this->assertFalse($row['needs_hours']);
    }

    public function test_tracked_and_hand_logged_minutes_on_one_day_are_one_row(): void
    {
        $task = $this->taskFor('Fix broken checkout links');
        TimeEntry::query()->create([
            'user_id' => $this->user->id,
            'task_id' => $task->id,
            'kind' => 'work',
            'started_at' => Carbon::parse('2026-08-04 09:00:00'),
            'ended_at' => Carbon::parse('2026-08-04 10:00:00'),
        ]);
        TaskNote::query()->create([
            'task_id' => $task->id,
            'body' => 'And the retest afterwards.',
            'time_minutes' => 30,
            'time_logged_by' => $this->user->id,
            'created_by' => $this->user->id,
            'created_at' => Carbon::parse('2026-08-04 15:00:00'),
        ]);

        $this->getJson('/api/timesheet')->assertOk()->assertJsonPath('data.entry_count', 1);
        $this->assertSame(90, $this->firstRow()['minutes']);
    }

    public function test_tracked_time_leaves_no_second_row_dated_on_completion(): void
    {
        $task = $this->taskFor('Fix broken checkout links');
        TimeEntry::query()->create([
            'user_id' => $this->user->id,
            'task_id' => $task->id,
            'kind' => 'work',
            'started_at' => Carbon::parse('2026-08-04 09:00:00'),
            'ended_at' => Carbon::parse('2026-08-04 10:00:00'),
        ]);
        $this->finish($task, '2026-08-05 16:00:00');

        $this->getJson('/api/timesheet')->assertOk()->assertJsonPath('data.entry_count', 1);
        $this->assertSame('2026-08-04', $this->firstRow()['date']);
    }

    public function test_work_somebody_else_finished_is_not_on_my_sheet(): void
    {
        $task = $this->taskFor('Fix broken checkout links');
        $task->update(['assignee_user_id' => $this->colleague->id]);
        $this->finish($task, '2026-08-05 16:00:00');

        $this->getJson('/api/timesheet')->assertOk()->assertJsonPath('data.entry_count', 0);

        $this->putJson('/api/timesheet/hours', ['task_id' => $task->id, 'date' => '2026-08-05', 'minutes' => 60])
            ->assertStatus(422);
    }

    public function test_reopening_a_task_takes_it_back_off_the_sheet(): void
    {
        $task = $this->taskFor('Fix broken checkout links');
        $this->finish($task, '2026-08-05 16:00:00');
        $this->getJson('/api/timesheet')->assertOk()->assertJsonPath('data.entry_count', 1);

        $task->update(['status_value_id' => TaskStatuses::id('in_progress')]);

        $this->assertNull($task->fresh()->completed_at);
        $this->getJson('/api/timesheet')->assertOk()->assertJsonPath('data.entry_count', 0);
    }

    /** @return array<string, mixed> */
    private function firstRow(): array
    {
        return $this->getJson('/api/timesheet')->assertOk()->json('data.lanes.0.rows.0');
    }

    private function finish(Task $task, string $at): void
    {
        $this->travelTo(Carbon::parse($at));
        $task->update(['status_value_id' => TaskStatuses::id('complete')]);
        $this->travelTo(Carbon::parse('2026-08-09 12:00:00'));
    }

    private function taskFor(string $title): Task
    {
        $project = Project::query()->create([
            'client_id' => $this->client->id,
            'name' => $this->client->name.' retainer',
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
        $this->roleSequence++;
        $role = Role::query()->create([
            'name' => "Timesheet role {$this->roleSequence}",
            'key_name' => "timesheet_finished_{$this->roleSequence}",
        ]);
        $role->permissions()->createMany(array_map(
            fn (string $key) => ['permission_key' => $key],
            ['dashboard.view', 'tasks.view', 'time.track'],
        ));

        return User::factory()->create(['role_id' => $role->id]);
    }
}
