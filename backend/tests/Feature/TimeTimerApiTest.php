<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Project;
use App\Models\Role;
use App\Models\Task;
use App\Models\TaskNote;
use App\Models\TimeEntry;
use App\Models\TimeSession;
use App\Models\User;
use App\Services\TimeEntryService;
use App\Support\TaskStatuses;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The per-task timer. It sits on top of attendance rather than replacing it:
 * starting a timer clocks you in, a timer break also opens the attendance break
 * that gates task edits, and clocking out closes whatever was running.
 */
class TimeTimerApiTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    private Task $task;

    private int $roleSequence = 0;

    protected function setUp(): void
    {
        parent::setUp();

        TaskStatuses::flush();
        $this->seed();
        $admin = User::query()->findOrFail(1);
        $this->user = $this->tracker();

        $client = Client::query()->create(['name' => 'Timer client', 'created_by' => $admin->id]);
        $project = Project::query()->create([
            'client_id' => $client->id,
            'name' => 'Timer project',
            'created_by' => $admin->id,
        ]);
        $this->task = Task::query()->create([
            'project_id' => $project->id,
            'title' => 'Design the pricing page',
            'status_value_id' => TaskStatuses::id('in_progress'),
            'actual_minutes' => 0,
            'assignee_user_id' => $this->user->id,
            'created_by' => $admin->id,
        ]);

        Sanctum::actingAs($this->user);
    }

    public function test_starting_the_timer_clocks_the_user_in(): void
    {
        $this->travelTo(Carbon::parse('2026-08-10 09:30:00'));

        $this->assertNull($this->openSession());

        $this->postJson('/api/time/timer/start', ['task_id' => $this->task->id])
            ->assertStatus(201)
            ->assertJsonPath('data.clocked_in', true)
            ->assertJsonPath('data.entry.kind', 'work')
            ->assertJsonPath('data.entry.task_id', $this->task->id)
            ->assertJsonPath('data.entry.task.title', 'Design the pricing page')
            ->assertJsonPath('data.paused_task', null)
            ->assertJsonPath('data.paused_seconds', 0)
            ->assertJsonCount(10, 'data.today.hours')
            ->assertJsonCount(7, 'data.week');

        $this->assertNotNull($this->openSession());
    }

    public function test_a_second_start_closes_the_first_entry_instead_of_opening_two(): void
    {
        $this->travelTo(Carbon::parse('2026-08-10 09:00:00'));
        $this->postJson('/api/time/timer/start', ['task_id' => $this->task->id])->assertStatus(201);

        $this->travelTo(Carbon::parse('2026-08-10 09:25:00'));
        $this->postJson('/api/time/timer/start')->assertStatus(201)
            ->assertJsonPath('data.entry.task_id', null);

        $entries = TimeEntry::query()->where('user_id', $this->user->id)->orderBy('id')->get();
        $this->assertCount(2, $entries);
        $this->assertNotNull($entries[0]->ended_at);
        $this->assertNull($entries[1]->ended_at);
    }

    public function test_a_break_needs_a_running_work_entry(): void
    {
        $this->postJson('/api/time/timer/break', ['kind' => 'Lunch', 'due_minutes' => 45])
            ->assertStatus(409)
            ->assertJsonPath('message', 'Start the timer before taking a break.');

        $this->postJson('/api/time/timer/resume')
            ->assertStatus(409)
            ->assertJsonPath('message', 'No break is in progress.');

        $this->postJson('/api/time/timer/stop')
            ->assertStatus(409)
            ->assertJsonPath('message', 'The timer is not running.');
    }

    public function test_resuming_returns_to_the_paused_task(): void
    {
        $this->travelTo(Carbon::parse('2026-08-10 10:00:00'));
        $this->postJson('/api/time/timer/start', ['task_id' => $this->task->id])->assertStatus(201);

        $this->travelTo(Carbon::parse('2026-08-10 10:40:00'));
        $this->postJson('/api/time/timer/break', ['kind' => 'Lunch', 'due_minutes' => 45])
            ->assertStatus(201)
            ->assertJsonPath('data.entry.kind', 'break')
            ->assertJsonPath('data.entry.break_kind', 'Lunch')
            ->assertJsonPath('data.entry.break_due_minutes', 45)
            ->assertJsonPath('data.paused_task.id', $this->task->id);

        $this->travelTo(Carbon::parse('2026-08-10 11:25:00'));
        $this->postJson('/api/time/timer/resume')
            ->assertOk()
            ->assertJsonPath('data.entry.kind', 'work')
            ->assertJsonPath('data.entry.task_id', $this->task->id)
            ->assertJsonPath('data.paused_task', null)
            ->assertJsonPath('data.paused_seconds', 0);
    }

    public function test_stopping_reports_the_minutes_it_logged(): void
    {
        $this->travelTo(Carbon::parse('2026-08-10 09:00:00'));
        $this->postJson('/api/time/timer/start', ['task_id' => $this->task->id])->assertStatus(201);

        $this->travelTo(Carbon::parse('2026-08-10 10:12:00'));
        $this->postJson('/api/time/timer/stop')
            ->assertOk()
            ->assertJsonPath('data.entry', null)
            ->assertJsonPath('data.logged.minutes', 72)
            ->assertJsonPath('data.logged.task.id', $this->task->id)
            ->assertJsonPath('data.today.work_minutes', 72);

        $this->assertSame(72, (int) $this->task->fresh()->actual_minutes);
    }

    public function test_a_stopped_break_logs_nothing(): void
    {
        $this->travelTo(Carbon::parse('2026-08-10 09:00:00'));
        $this->postJson('/api/time/timer/start', ['task_id' => $this->task->id])->assertStatus(201);
        $this->travelTo(Carbon::parse('2026-08-10 09:30:00'));
        $this->postJson('/api/time/timer/break', ['kind' => 'Coffee', 'due_minutes' => 15])->assertStatus(201);

        $this->travelTo(Carbon::parse('2026-08-10 09:45:00'));
        $this->postJson('/api/time/timer/stop')
            ->assertOk()
            ->assertJsonPath('data.logged.minutes', 0)
            ->assertJsonPath('data.today.work_minutes', 30)
            ->assertJsonPath('data.today.break_minutes', 15);
    }

    public function test_clocking_out_closes_a_running_entry(): void
    {
        $this->travelTo(Carbon::parse('2026-08-10 09:00:00'));
        $this->postJson('/api/time/timer/start', ['task_id' => $this->task->id])->assertStatus(201);

        $this->travelTo(Carbon::parse('2026-08-10 09:45:00'));
        $this->postJson('/api/time/clock-out')->assertOk();

        $this->assertNotNull(TimeEntry::query()->where('user_id', $this->user->id)->firstOrFail()->ended_at);
        $this->assertSame(45, (int) $this->task->fresh()->actual_minutes);

        $this->getJson('/api/time/timer')
            ->assertOk()
            ->assertJsonPath('data.entry', null)
            ->assertJsonPath('data.clocked_in', false);
    }

    public function test_a_timer_break_blocks_task_edits_until_it_is_resumed(): void
    {
        $this->travelTo(Carbon::parse('2026-08-10 09:00:00'));
        $this->postJson('/api/time/timer/start', ['task_id' => $this->task->id])->assertStatus(201);
        $this->getJson('/api/time')->assertOk()->assertJsonPath('data.can_mutate_tasks', true);

        $this->postJson('/api/time/timer/break', ['kind' => 'Lunch', 'due_minutes' => 45])->assertStatus(201);
        $this->getJson('/api/time')
            ->assertOk()
            ->assertJsonPath('data.can_mutate_tasks', false)
            ->assertJsonPath('data.is_on_break', true);

        $this->postJson('/api/time/timer/resume')->assertOk();
        $this->getJson('/api/time')
            ->assertOk()
            ->assertJsonPath('data.can_mutate_tasks', true)
            ->assertJsonPath('data.is_on_break', false);
    }

    public function test_stopping_while_on_a_break_leaves_no_open_attendance_break(): void
    {
        $this->travelTo(Carbon::parse('2026-08-10 09:00:00'));
        $this->postJson('/api/time/timer/start', ['task_id' => $this->task->id])->assertStatus(201);
        $this->postJson('/api/time/timer/break', ['kind' => 'Lunch', 'due_minutes' => 45])->assertStatus(201);

        $this->travelTo(Carbon::parse('2026-08-10 09:40:00'));
        $this->postJson('/api/time/timer/stop')->assertOk()->assertJsonPath('data.clocked_in', true);

        $this->getJson('/api/time')
            ->assertOk()
            ->assertJsonPath('data.is_clocked_in', true)
            ->assertJsonPath('data.is_on_break', false)
            ->assertJsonPath('data.can_mutate_tasks', true);
    }

    public function test_paused_seconds_accumulate_across_the_session(): void
    {
        $this->travelTo(Carbon::parse('2026-08-10 09:00:00'));
        $this->postJson('/api/time/timer/start', ['task_id' => $this->task->id])->assertStatus(201);

        $this->travelTo(Carbon::parse('2026-08-10 09:40:00'));
        $this->postJson('/api/time/timer/break', ['kind' => 'Coffee', 'due_minutes' => 15])
            ->assertStatus(201)
            ->assertJsonPath('data.paused_seconds', 2400);

        $this->travelTo(Carbon::parse('2026-08-10 09:55:00'));
        $this->postJson('/api/time/timer/resume')->assertOk();

        $this->travelTo(Carbon::parse('2026-08-10 10:15:00'));
        $this->postJson('/api/time/timer/break', ['kind' => 'Lunch', 'due_minutes' => 45])
            ->assertStatus(201)
            ->assertJsonPath('data.paused_task.id', $this->task->id)
            // Both runs on the task, not only the most recent one.
            ->assertJsonPath('data.paused_seconds', 3600);
    }

    public function test_an_entry_spanning_hours_is_split_across_the_buckets_it_covers(): void
    {
        TimeEntry::query()->create([
            'user_id' => $this->user->id,
            'task_id' => $this->task->id,
            'kind' => 'work',
            'started_at' => Carbon::parse('2026-08-10 10:40:00'),
            'ended_at' => Carbon::parse('2026-08-10 12:10:00'),
        ]);
        // Before the window opens, so it folds into the 9am bucket.
        TimeEntry::query()->create([
            'user_id' => $this->user->id,
            'task_id' => $this->task->id,
            'kind' => 'work',
            'started_at' => Carbon::parse('2026-08-10 07:00:00'),
            'ended_at' => Carbon::parse('2026-08-10 07:30:00'),
        ]);

        $this->travelTo(Carbon::parse('2026-08-10 13:00:00'));
        $response = $this->getJson('/api/time/timer')->assertOk();

        // JSON drops a trailing .0, so the buckets are compared as numbers.
        $hours = collect($response->json('data.today.hours'))->keyBy('hour');
        $this->assertSame(30.0, (float) $hours[9]['work_minutes']);
        $this->assertSame(20.0, (float) $hours[10]['work_minutes']);
        $this->assertSame(60.0, (float) $hours[11]['work_minutes']);
        $this->assertSame(10.0, (float) $hours[12]['work_minutes']);
        $this->assertSame(0.0, (float) $hours[13]['work_minutes']);
        $this->assertSame(120, $response->json('data.today.work_minutes'));

        // Monday through Sunday of the week containing today.
        $this->assertSame('2026-08-10', $response->json('data.week.0.date'));
        $this->assertSame('2026-08-16', $response->json('data.week.6.date'));
        $this->assertSame(120, $response->json('data.week.0.work_minutes'));
    }

    public function test_timer_time_and_note_time_reconcile_and_recomputing_is_idempotent(): void
    {
        TaskNote::query()->create([
            'task_id' => $this->task->id,
            'body' => 'Logged the kickoff call by hand.',
            'time_minutes' => 30,
            'time_logged_by' => $this->user->id,
            'created_by' => $this->user->id,
        ]);
        $this->task->update(['actual_minutes' => 30]);

        $this->travelTo(Carbon::parse('2026-08-10 09:00:00'));
        $this->postJson('/api/time/timer/start', ['task_id' => $this->task->id])->assertStatus(201);
        $this->travelTo(Carbon::parse('2026-08-10 10:30:00'));
        $this->postJson('/api/time/timer/stop')->assertOk()->assertJsonPath('data.logged.minutes', 90);

        $this->assertSame(120, (int) $this->task->fresh()->actual_minutes);

        app(TimeEntryService::class)->reconcile($this->task->id);
        $this->assertSame(120, (int) $this->task->fresh()->actual_minutes);
    }

    public function test_the_timer_needs_the_time_track_permission(): void
    {
        $stranger = User::factory()->create(['role_id' => $this->roleFor([])->id]);
        Sanctum::actingAs($stranger);

        $this->getJson('/api/time/timer')->assertStatus(403);
        $this->postJson('/api/time/timer/start')->assertStatus(403);
    }

    private function openSession(): ?TimeSession
    {
        return TimeSession::query()->where('user_id', $this->user->id)->whereNull('clock_out_at')->first();
    }

    private function tracker(): User
    {
        return User::factory()->create(['role_id' => $this->roleFor(['time.track'])->id]);
    }

    /**
     * @param  array<int, string>  $permissions
     */
    private function roleFor(array $permissions): Role
    {
        $this->roleSequence++;
        $role = Role::query()->create([
            'name' => "Timer role {$this->roleSequence}",
            'key_name' => "timer_{$this->roleSequence}",
        ]);
        $keys = array_values(array_unique(['dashboard.view', 'tasks.view', ...$permissions]));
        $role->permissions()->createMany(array_map(
            fn (string $key) => ['permission_key' => $key],
            $keys,
        ));

        return $role;
    }
}
