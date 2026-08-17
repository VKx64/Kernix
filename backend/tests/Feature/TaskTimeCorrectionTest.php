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
 * Logged time only ever went up: it is recomputed from timer entries and note
 * minutes, and both could only be positive. A timer left running through lunch
 * stayed on the record for good.
 *
 * A manager can now set what a task actually cost. An employee cannot — they
 * log their own time and do not get to rewrite it afterwards.
 */
class TaskTimeCorrectionTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $manager;

    private User $employee;

    private Task $task;

    private int $roleSequence = 0;

    protected function setUp(): void
    {
        parent::setUp();

        TaskStatuses::flush();
        $this->seed();
        $this->admin = User::query()->findOrFail(1);
        $this->manager = $this->userWith(['tasks.comment', 'tasks.log_time', 'tasks.assign', 'tasks.adjust_time']);
        $this->employee = $this->userWith(['tasks.comment', 'tasks.log_time']);

        $client = Client::query()->create(['name' => 'Northwind Creative', 'created_by' => $this->admin->id]);
        $project = Project::query()->create([
            'client_id' => $client->id,
            'name' => 'Northwind retainer',
            'created_by' => $this->admin->id,
        ]);
        $this->task = Task::query()->create([
            'project_id' => $project->id,
            'title' => 'Cut the launch reel',
            'status_value_id' => TaskStatuses::id('in_progress'),
            'actual_minutes' => 0,
            'assignee_user_id' => $this->employee->id,
            'created_by' => $this->admin->id,
        ]);

        // Four hours the employee never worked: the timer ran through lunch.
        TimeEntry::query()->create([
            'user_id' => $this->employee->id,
            'task_id' => $this->task->id,
            'kind' => 'work',
            'started_at' => Carbon::parse('2026-08-05 09:00:00'),
            'ended_at' => Carbon::parse('2026-08-05 13:00:00'),
        ]);
        $this->task->update(['actual_minutes' => 240]);
    }

    public function test_a_manager_can_bring_an_overstated_total_back_down(): void
    {
        Sanctum::actingAs($this->manager);

        $this->putJson("/api/tasks/{$this->task->id}/time", ['minutes' => 150])
            ->assertOk()
            ->assertJsonPath('data.actual_minutes', 150);

        $this->assertSame(150, (int) $this->task->fresh()->actual_minutes);

        // The correction is a note, so the task's own history says who changed
        // the figure and by how much.
        $correction = TaskNote::query()->where('task_id', $this->task->id)->latest('id')->firstOrFail();
        $this->assertSame(-90, (int) $correction->time_minutes);
        $this->assertSame($this->manager->id, (int) $correction->created_by);
        $this->assertStringContainsString('Corrected the logged time', $correction->body);
    }

    public function test_the_corrected_minutes_belong_to_whoever_did_the_work(): void
    {
        Sanctum::actingAs($this->manager);
        $this->putJson("/api/tasks/{$this->task->id}/time", ['minutes' => 150])->assertOk();

        // Not the manager's timesheet. The figure being corrected is the
        // employee's, and so is the correction.
        $this->assertSame(
            $this->employee->id,
            (int) TaskNote::query()->where('task_id', $this->task->id)->latest('id')->value('time_logged_by'),
        );
    }

    public function test_a_correction_survives_the_next_recompute(): void
    {
        Sanctum::actingAs($this->manager);
        $this->putJson("/api/tasks/{$this->task->id}/time", ['minutes' => 150])->assertOk();

        // Another sitting on the same task recomputes the total from scratch.
        TimeEntry::query()->create([
            'user_id' => $this->employee->id,
            'task_id' => $this->task->id,
            'kind' => 'work',
            'started_at' => Carbon::parse('2026-08-06 09:00:00'),
            'ended_at' => Carbon::parse('2026-08-06 09:30:00'),
        ]);
        app(TimeEntryService::class)->reconcile($this->task->id);

        $this->assertSame(180, (int) $this->task->fresh()->actual_minutes);
    }

    public function test_a_manager_can_raise_a_total_that_was_never_tracked(): void
    {
        Sanctum::actingAs($this->manager);

        $this->putJson("/api/tasks/{$this->task->id}/time", [
            'minutes' => 300,
            'reason' => 'Two hours on the phone with the client that nobody logged.',
        ])->assertOk()->assertJsonPath('data.actual_minutes', 300);

        $this->assertSame(
            'Two hours on the phone with the client that nobody logged.',
            TaskNote::query()->where('task_id', $this->task->id)->latest('id')->value('body'),
        );
    }

    public function test_an_employee_cannot_rewrite_what_their_work_cost(): void
    {
        Sanctum::actingAs($this->employee);

        $this->putJson("/api/tasks/{$this->task->id}/time", ['minutes' => 60])
            ->assertForbidden();

        $this->assertSame(240, (int) $this->task->fresh()->actual_minutes);
    }

    public function test_an_administrator_needs_no_permission_of_their_own(): void
    {
        TimeSession::query()->create(['user_id' => $this->admin->id, 'clock_in_at' => now()]);
        Sanctum::actingAs($this->admin);

        $this->putJson("/api/tasks/{$this->task->id}/time", ['minutes' => 90])
            ->assertOk()
            ->assertJsonPath('data.actual_minutes', 90);
    }

    public function test_setting_the_same_total_changes_nothing_and_writes_no_note(): void
    {
        Sanctum::actingAs($this->manager);

        $this->putJson("/api/tasks/{$this->task->id}/time", ['minutes' => 240])->assertOk();

        $this->assertSame(0, TaskNote::query()->where('task_id', $this->task->id)->count());
    }

    public function test_a_negative_total_is_refused(): void
    {
        Sanctum::actingAs($this->manager);

        $this->putJson("/api/tasks/{$this->task->id}/time", ['minutes' => -30])
            ->assertStatus(422)
            ->assertJsonValidationErrors('minutes');
    }

    /** @param  array<int, string>  $permissions */
    private function userWith(array $permissions): User
    {
        $this->roleSequence++;
        $role = Role::query()->create([
            'name' => "Time correction role {$this->roleSequence}",
            'key_name' => "time_correction_{$this->roleSequence}",
        ]);
        $keys = array_values(array_unique([
            'dashboard.view', 'messages.view', 'tasks.view', 'time.track', ...$permissions,
        ]));
        $role->permissions()->createMany(array_map(
            fn (string $key) => ['permission_key' => $key],
            $keys,
        ));
        $user = User::factory()->create(['role_id' => $role->id]);
        TimeSession::query()->create(['user_id' => $user->id, 'clock_in_at' => now()]);

        return $user;
    }
}
