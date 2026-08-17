<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Project;
use App\Models\Role;
use App\Models\Task;
use App\Models\TaskWorkRequest;
use App\Models\TimeSession;
use App\Models\User;
use App\Support\TaskStatuses;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * An employee may write down a job they have noticed. They may not hand it to
 * themselves — the task lands on the project manager with a request attached,
 * and stays untouchable until that request is approved.
 */
class SelfRaisedTaskApprovalTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $manager;

    private User $employee;

    private Project $project;

    private int $roleSequence = 0;

    protected function setUp(): void
    {
        parent::setUp();

        TaskStatuses::flush();
        $this->seed();
        $this->admin = User::query()->findOrFail(1);

        $this->manager = $this->userWith(['tasks.create', 'tasks.assign', 'tasks.edit', 'tasks.review_work_requests']);
        $this->employee = $this->userWith(['tasks.create', 'tasks.request_work', 'tasks.comment']);

        $client = Client::query()->create(['name' => 'Self raised client', 'created_by' => $this->admin->id]);
        $this->project = Project::query()->create([
            'client_id' => $client->id,
            'name' => 'Self raised project',
            'manager_user_id' => $this->manager->id,
            'created_by' => $this->admin->id,
        ]);
    }

    public function test_a_task_an_employee_raises_lands_on_the_manager_with_a_request_attached(): void
    {
        Sanctum::actingAs($this->employee);

        $response = $this->postJson('/api/tasks', [
            'project_id' => $this->project->id,
            'title' => 'Re-cut the trailer audio',
            'description' => 'The mix clips on the last eight seconds and the client noticed.',
        ])->assertCreated()->assertJsonPath('data.work_request_raised', true);

        $task = Task::query()->findOrFail($response->json('data.id'));
        $this->assertSame($this->manager->id, (int) $task->assignee_user_id);
        $this->assertNotContains($this->employee->id, $task->assignees()->pluck('users.id')->all());

        $this->assertDatabaseHas('task_work_requests', [
            'task_id' => $task->id,
            'requester_user_id' => $this->employee->id,
            'status' => TaskWorkRequest::PENDING,
        ]);
    }

    public function test_the_employee_cannot_work_on_it_until_the_manager_approves(): void
    {
        Sanctum::actingAs($this->employee);
        $taskId = (int) $this->postJson('/api/tasks', [
            'project_id' => $this->project->id,
            'title' => 'Re-cut the trailer audio',
            'description' => 'The mix clips on the last eight seconds and the client noticed.',
        ])->assertCreated()->json('data.id');

        $this->postJson("/api/tasks/{$taskId}/notes", ['body' => 'Starting on this now.'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'TASK_NOT_ASSIGNED');

        $workRequest = TaskWorkRequest::query()->where('task_id', $taskId)->firstOrFail();

        Sanctum::actingAs($this->manager);
        $this->postJson("/api/tasks/{$taskId}/work-requests/{$workRequest->id}/approve")->assertOk();

        $task = Task::query()->findOrFail($taskId);
        $this->assertSame($this->employee->id, (int) $task->assignee_user_id);
        // The pivot has to agree, or the task shows up under the wrong person
        // everywhere the multi-assignee list is read.
        $this->assertSame([$this->employee->id], $task->assignees()->pluck('users.id')->all());

        Sanctum::actingAs($this->employee);
        $this->postJson("/api/tasks/{$taskId}/notes", ['body' => 'Starting on this now.'])->assertCreated();
    }

    public function test_a_declined_request_leaves_the_employee_where_they_were(): void
    {
        Sanctum::actingAs($this->employee);
        $taskId = (int) $this->postJson('/api/tasks', [
            'project_id' => $this->project->id,
            'title' => 'Re-cut the trailer audio',
            'description' => 'The mix clips on the last eight seconds and the client noticed.',
        ])->assertCreated()->json('data.id');

        $workRequest = TaskWorkRequest::query()->where('task_id', $taskId)->firstOrFail();

        Sanctum::actingAs($this->manager);
        $this->postJson("/api/tasks/{$taskId}/work-requests/{$workRequest->id}/decline", [
            'reason' => 'Finish the launch reel first, this can wait a week.',
        ])->assertOk();

        $this->assertSame($this->manager->id, (int) Task::query()->findOrFail($taskId)->assignee_user_id);

        Sanctum::actingAs($this->employee);
        $this->postJson("/api/tasks/{$taskId}/notes", ['body' => 'Starting anyway.'])
            ->assertStatus(409);
    }

    public function test_the_manager_shows_the_request_in_the_review_queue(): void
    {
        Sanctum::actingAs($this->employee);
        $this->postJson('/api/tasks', [
            'project_id' => $this->project->id,
            'title' => 'Re-cut the trailer audio',
            'description' => 'The mix clips on the last eight seconds and the client noticed.',
        ])->assertCreated();

        Sanctum::actingAs($this->manager);
        $pending = $this->getJson('/api/task-work-requests/pending')->assertOk()->json('data');

        $this->assertCount(1, $pending);
        $this->assertSame($this->employee->id, $pending[0]['requester']['id']);
    }

    public function test_somebody_who_can_assign_raises_no_request(): void
    {
        Sanctum::actingAs($this->manager);

        $response = $this->postJson('/api/tasks', [
            'project_id' => $this->project->id,
            'title' => 'Book the studio for Thursday',
            'description' => 'The reshoot needs the big room and the overhead rig.',
        ])->assertCreated()->assertJsonPath('data.work_request_raised', false);

        $this->assertDatabaseCount('task_work_requests', 0);
        $this->assertSame($this->manager->id, (int) Task::query()->findOrFail($response->json('data.id'))->assignee_user_id);
    }

    public function test_a_task_that_lands_on_its_creator_has_nothing_to_approve(): void
    {
        // No manager on the project, so the task falls to whoever made it and
        // there is no gap between raising the work and being allowed to do it.
        $this->project->update(['manager_user_id' => null]);

        Sanctum::actingAs($this->employee);
        $response = $this->postJson('/api/tasks', [
            'project_id' => $this->project->id,
            'title' => 'Re-cut the trailer audio',
            'description' => 'The mix clips on the last eight seconds and the client noticed.',
        ])->assertCreated()->assertJsonPath('data.work_request_raised', false);

        $this->assertDatabaseCount('task_work_requests', 0);
        $this->assertSame($this->employee->id, (int) Task::query()->findOrFail($response->json('data.id'))->assignee_user_id);
    }

    /**
     * @param  array<int, string>  $permissions
     */
    private function userWith(array $permissions): User
    {
        $this->roleSequence++;
        $role = Role::query()->create([
            'name' => "Self raised role {$this->roleSequence}",
            'key_name' => "self_raised_{$this->roleSequence}",
        ]);
        // `messages.view` is not decoration: the catalog makes both halves of
        // the work-request flow depend on it, since a request is a
        // conversation with whoever decides it.
        $keys = array_values(array_unique([
            'dashboard.view', 'messages.view', 'tasks.view', 'projects.view', 'time.track', ...$permissions,
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
