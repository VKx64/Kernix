<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Project;
use App\Models\Role;
use App\Models\Task;
use App\Models\TaskSubtask;
use App\Models\TaskWorkRequest;
use App\Models\TimeSession;
use App\Models\User;
use App\Support\TaskStatuses;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Work is limited to your own assignments, and asking to be put on a task is
 * the sanctioned way around that. These cover both halves: the gate itself and
 * the request flow that exists because of it.
 */
class TaskWorkRequestApiTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $assignee;

    private Task $task;

    private int $roleSequence = 0;

    protected function setUp(): void
    {
        parent::setUp();

        TaskStatuses::flush();
        $this->seed();
        $this->admin = User::query()->findOrFail(1);
        $this->assignee = $this->userWith(['tasks.comment', 'tasks.edit']);

        $client = Client::query()->create(['name' => 'Work request client', 'created_by' => $this->admin->id]);
        $project = Project::query()->create([
            'client_id' => $client->id,
            'name' => 'Work request project',
            'created_by' => $this->admin->id,
        ]);
        $this->task = Task::query()->create([
            'project_id' => $project->id,
            'title' => 'Cut the launch reel',
            'description' => 'Assemble the sixty second launch reel from the approved selects.',
            'status_value_id' => TaskStatuses::id('in_progress'),
            'actual_minutes' => 0,
            'assignee_user_id' => $this->assignee->id,
            // Deliberately the admin, so the created_by carve-out never masks
            // the gate for the users under test.
            'created_by' => $this->admin->id,
        ]);
    }

    public function test_a_non_assignee_without_the_bypass_cannot_work_on_the_task(): void
    {
        $stranger = $this->userWith(['tasks.comment', 'tasks.edit']);
        Sanctum::actingAs($stranger);

        $this->postJson("/api/tasks/{$this->task->id}/notes", ['body' => 'Picking this up.'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'TASK_NOT_ASSIGNED');

        $this->patchJson("/api/tasks/{$this->task->id}", ['title' => 'Renamed by a stranger'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'TASK_NOT_ASSIGNED');

        $this->assertSame('Cut the launch reel', $this->task->fresh()->title);
    }

    public function test_the_assignee_and_the_bypass_holder_both_pass(): void
    {
        Sanctum::actingAs($this->assignee);
        $this->postJson("/api/tasks/{$this->task->id}/notes", ['body' => 'Working on it now.'])
            ->assertStatus(201);

        $manager = $this->userWith(['tasks.comment', 'tasks.edit', 'tasks.work_unassigned']);
        Sanctum::actingAs($manager);
        $this->postJson("/api/tasks/{$this->task->id}/notes", ['body' => 'Reviewed the first pass.'])
            ->assertStatus(201);
    }

    public function test_the_creator_can_still_act_on_a_task_assigned_to_someone_else(): void
    {
        // A task defaults to the project manager as assignee, so the person who
        // created it is routinely not the assignee.
        $creator = $this->userWith(['tasks.comment']);
        $this->task->update(['created_by' => $creator->id]);
        Sanctum::actingAs($creator);

        $this->postJson("/api/tasks/{$this->task->id}/notes", ['body' => 'Adding the brief I promised.'])
            ->assertStatus(201);
    }

    public function test_a_subtask_assignee_can_act_on_the_parent_task(): void
    {
        $helper = $this->userWith(['tasks.comment']);
        TaskSubtask::query()->create([
            'task_id' => $this->task->id,
            'title' => 'Pull the selects',
            'assignee_user_id' => $helper->id,
            'sort_order' => 0,
            'created_by' => $this->admin->id,
        ]);
        Sanctum::actingAs($helper);

        $this->postJson("/api/tasks/{$this->task->id}/notes", ['body' => 'Selects are pulled and uploaded.'])
            ->assertStatus(201);
    }

    public function test_approving_a_request_hands_the_task_to_the_requester(): void
    {
        $requester = $this->userWith(['tasks.comment', 'tasks.request_work', 'messages.view']);
        Sanctum::actingAs($requester);
        $created = $this->postJson("/api/tasks/{$this->task->id}/work-requests", [
            'reason' => 'The assignee is out sick and this ships tomorrow.',
        ])->assertStatus(201);
        $requestId = $created->json('data.id');

        $reviewer = $this->userWith(['tasks.assign', 'tasks.review_work_requests', 'messages.view']);
        Sanctum::actingAs($reviewer);
        $this->postJson("/api/tasks/{$this->task->id}/work-requests/{$requestId}/approve")
            ->assertOk()
            ->assertJsonPath('data.status', 'approved');

        $this->assertSame($requester->id, $this->task->fresh()->assignee_user_id);

        // The point of the whole flow: the requester can now actually work.
        Sanctum::actingAs($requester);
        $this->postJson("/api/tasks/{$this->task->id}/notes", ['body' => 'Taking it from here.'])
            ->assertStatus(201);
    }

    public function test_declining_needs_a_reason_and_leaves_the_assignee_alone(): void
    {
        $requestId = $this->requestFrom($this->userWith(['tasks.comment', 'tasks.request_work', 'messages.view']));

        $reviewer = $this->userWith(['tasks.assign', 'tasks.review_work_requests', 'messages.view']);
        Sanctum::actingAs($reviewer);

        $this->postJson("/api/tasks/{$this->task->id}/work-requests/{$requestId}/decline")
            ->assertStatus(422)
            ->assertJsonValidationErrors(['reason']);

        $this->postJson("/api/tasks/{$this->task->id}/work-requests/{$requestId}/decline", [
            'reason' => 'The current assignee is back tomorrow.',
        ])->assertOk()->assertJsonPath('data.status', 'declined');

        $this->assertSame($this->assignee->id, $this->task->fresh()->assignee_user_id);
    }

    public function test_a_second_pending_request_from_the_same_person_is_rejected(): void
    {
        $requester = $this->userWith(['tasks.comment', 'tasks.request_work', 'messages.view']);
        $this->requestFrom($requester);

        Sanctum::actingAs($requester);
        $this->postJson("/api/tasks/{$this->task->id}/work-requests", [
            'reason' => 'Asking a second time in case the first was missed.',
        ])->assertStatus(409);

        $this->assertSame(1, TaskWorkRequest::query()->where('task_id', $this->task->id)->count());
    }

    public function test_you_cannot_decide_your_own_request(): void
    {
        // Holding both permissions is legitimate; approving your own grab is not.
        $both = $this->userWith([
            'tasks.comment', 'tasks.request_work', 'tasks.assign', 'tasks.review_work_requests', 'messages.view',
        ]);
        $requestId = $this->requestFrom($both);

        Sanctum::actingAs($both);
        $this->postJson("/api/tasks/{$this->task->id}/work-requests/{$requestId}/approve")
            ->assertStatus(403);

        $this->assertSame($this->assignee->id, $this->task->fresh()->assignee_user_id);
    }

    public function test_only_the_requester_may_withdraw_and_only_while_pending(): void
    {
        $requester = $this->userWith(['tasks.comment', 'tasks.request_work', 'messages.view']);
        $requestId = $this->requestFrom($requester);

        $other = $this->userWith(['tasks.comment', 'tasks.request_work', 'messages.view']);
        Sanctum::actingAs($other);
        $this->postJson("/api/tasks/{$this->task->id}/work-requests/{$requestId}/withdraw")
            ->assertStatus(403);

        Sanctum::actingAs($requester);
        $this->postJson("/api/tasks/{$this->task->id}/work-requests/{$requestId}/withdraw")
            ->assertOk()
            ->assertJsonPath('data.status', 'withdrawn');

        $this->postJson("/api/tasks/{$this->task->id}/work-requests/{$requestId}/withdraw")
            ->assertStatus(409);
    }

    /**
     * @param  array<int, string>  $permissions
     */
    private function userWith(array $permissions): User
    {
        $this->roleSequence++;
        $role = Role::query()->create([
            'name' => "Work request role {$this->roleSequence}",
            'key_name' => "work_request_{$this->roleSequence}",
        ]);
        $keys = array_values(array_unique(['dashboard.view', 'tasks.view', 'time.track', ...$permissions]));
        $role->permissions()->createMany(array_map(
            fn (string $key) => ['permission_key' => $key],
            $keys,
        ));
        $user = User::factory()->create(['role_id' => $role->id]);
        TimeSession::query()->create(['user_id' => $user->id, 'clock_in_at' => now()]);

        return $user;
    }

    private function requestFrom(User $requester): int
    {
        Sanctum::actingAs($requester);

        return (int) $this->postJson("/api/tasks/{$this->task->id}/work-requests", [
            'reason' => 'I have the footage open and the assignee is unavailable.',
        ])->assertStatus(201)->json('data.id');
    }
}
