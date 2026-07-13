<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\FieldValue;
use App\Models\Project;
use App\Models\Role;
use App\Models\Task;
use App\Models\TaskEmail;
use App\Models\TaskNote;
use App\Models\TaskSubtask;
use App\Models\TimeSession;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class TaskPermissionBoundariesTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private Project $project;

    private Task $task;

    private int $roleSequence = 0;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed();
        $this->admin = User::query()->findOrFail(1);
        $client = Client::query()->create([
            'name' => 'Permission boundary client',
            'created_by' => $this->admin->id,
        ]);
        $this->project = Project::query()->create([
            'client_id' => $client->id,
            'name' => 'Permission boundary project',
            'created_by' => $this->admin->id,
        ]);
        $this->task = Task::query()->create([
            'project_id' => $this->project->id,
            'title' => 'Permission boundary task',
            'status_value_id' => $this->taskStatus('pending')->id,
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);
    }

    public function test_task_metadata_and_status_have_independent_permissions_and_authorization_precedes_clock_guard(): void
    {
        $editor = $this->actAs(['tasks.edit']);

        $this->patchJson("/api/tasks/{$this->task->id}", [
            'title' => 'Edited metadata',
            'description' => 'Core metadata is editable.',
        ])->assertOk();
        $this->assertDatabaseHas('tasks', [
            'id' => $this->task->id,
            'title' => 'Edited metadata',
        ]);

        $this->patchJson("/api/tasks/{$this->task->id}", [
            'status_value_id' => $this->taskStatus('complete')->id,
        ])->assertForbidden();

        $statusChanger = $this->actAs(['tasks.change_status']);
        $this->patchJson("/api/tasks/{$this->task->id}", [
            'status_value_id' => $this->taskStatus('complete')->id,
        ])->assertOk();
        $this->patchJson("/api/tasks/{$this->task->id}", [
            'title' => 'Not allowed by status permission',
        ])->assertForbidden();

        $clockedOutEditor = $this->actAs(['tasks.edit'], false);
        $this->patchJson("/api/tasks/{$this->task->id}", [
            'title' => 'Clock-in required',
        ])->assertStatus(409)->assertJsonPath('code', 'CLOCK_IN_REQUIRED');

        // A missing field permission is reported as 403 even while clocked out.
        $this->patchJson("/api/tasks/{$this->task->id}", [
            'status_value_id' => $this->taskStatus('pending')->id,
        ])->assertForbidden();

        $this->assertNotSame($editor->id, $statusChanger->id);
        $this->assertNotSame($statusChanger->id, $clockedOutEditor->id);
    }

    public function test_create_assignment_and_estimate_permissions_only_control_their_own_fields(): void
    {
        $creator = $this->actAs(['tasks.create']);
        $createdId = $this->postJson('/api/tasks', [
            'project_id' => $this->project->id,
            'title' => 'Created without optional powers',
        ])->assertCreated()->json('data.id');

        $this->postJson('/api/tasks', [
            'project_id' => $this->project->id,
            'title' => 'Estimate injection',
            'estimated_minutes' => 30,
        ])->assertForbidden();
        $this->assertDatabaseMissing('tasks', ['title' => 'Estimate injection']);

        $target = User::factory()->create();
        $assigner = $this->actAs(['tasks.assign']);
        $this->patchJson("/api/tasks/{$createdId}", [
            'assignee_user_id' => $target->id,
        ])->assertOk();
        $this->patchJson("/api/tasks/{$createdId}", [
            'estimated_minutes' => 90,
        ])->assertForbidden();

        $estimator = $this->actAs(['tasks.estimate']);
        $this->patchJson("/api/tasks/{$createdId}", [
            'estimated_minutes' => 90,
        ])->assertOk();
        $this->patchJson("/api/tasks/{$createdId}", [
            'assignee_user_id' => $estimator->id,
        ])->assertForbidden();

        $this->assertDatabaseHas('tasks', [
            'id' => $createdId,
            'assignee_user_id' => $target->id,
            'estimated_minutes' => 90,
        ]);
        $this->assertNotSame($creator->id, $assigner->id);
    }

    public function test_subtask_structure_status_assignment_and_estimate_permissions_are_separate(): void
    {
        $structurer = $this->actAs(['tasks.subtasks']);
        $subtaskId = $this->postJson("/api/tasks/{$this->task->id}/subtasks", [
            'title' => 'Structured subtask',
            'due_date' => now()->addDay()->toDateString(),
        ])->assertCreated()->json('data.id');

        $this->patchJson("/api/tasks/{$this->task->id}/subtasks/{$subtaskId}", [
            'title' => 'Reordered structure',
            'sort_order' => 20,
        ])->assertOk();
        $this->patchJson("/api/tasks/{$this->task->id}/subtasks/{$subtaskId}", [
            'estimated_minutes' => 20,
        ])->assertForbidden();

        $statusChanger = $this->actAs(['tasks.change_status']);
        $this->patchJson("/api/tasks/{$this->task->id}/subtasks/{$subtaskId}/complete", [
            'complete' => true,
        ])->assertOk();
        $this->assertNotNull(TaskSubtask::query()->findOrFail($subtaskId)->completed_at);
        $this->patchJson("/api/tasks/{$this->task->id}/subtasks/{$subtaskId}", [
            'status_value_id' => $this->taskStatus('pending')->id,
        ])->assertOk();
        $this->assertNull(TaskSubtask::query()->findOrFail($subtaskId)->completed_at);
        $this->patchJson("/api/tasks/{$this->task->id}/subtasks/{$subtaskId}", [
            'title' => 'Status cannot edit structure',
        ])->assertForbidden();

        $estimator = $this->actAs(['tasks.estimate']);
        $this->patchJson("/api/tasks/{$this->task->id}/subtasks/{$subtaskId}", [
            'estimated_minutes' => 20,
        ])->assertOk();

        $target = User::factory()->create();
        $this->actAs(['tasks.assign']);
        $this->patchJson("/api/tasks/{$this->task->id}/subtasks/{$subtaskId}", [
            'assignee_user_id' => $target->id,
        ])->assertOk();

        Sanctum::actingAs($structurer);
        $this->deleteJson("/api/tasks/{$this->task->id}/subtasks/{$subtaskId}")
            ->assertNoContent();
        $this->assertSoftDeleted('task_subtasks', ['id' => $subtaskId]);
        $this->assertNotSame($statusChanger->id, $estimator->id);
    }

    public function test_comment_permission_allows_zero_minute_notes_but_logged_time_requires_log_time_permission(): void
    {
        $commenter = $this->actAs(['tasks.comment']);
        $plainNoteId = $this->postJson("/api/tasks/{$this->task->id}/notes", [
            'body' => 'A plain comment with the UI zero-minute value.',
            'time_minutes' => 0,
        ])->assertCreated()->json('data.id');

        $this->patchJson("/api/tasks/{$this->task->id}/notes/{$plainNoteId}", [
            'body' => 'The author can edit this comment.',
            'time_minutes' => 0,
        ])->assertOk();

        $this->postJson("/api/tasks/{$this->task->id}/notes", [
            'body' => 'Unauthorized work log',
            'time_minutes' => 15,
        ])->assertForbidden();
        $this->assertSame(0, $this->task->fresh()->actual_minutes);

        $otherCommenter = $this->actAs(['tasks.comment']);
        $this->patchJson("/api/tasks/{$this->task->id}/notes/{$plainNoteId}", [
            'body' => 'Another commenter cannot edit the author note.',
        ])->assertForbidden();

        Sanctum::actingAs($commenter);
        $oldNote = TaskNote::query()->create([
            'task_id' => $this->task->id,
            'body' => 'An old author note',
            'created_by' => $commenter->id,
            'created_at' => now()->subDays(2),
            'updated_at' => now()->subDays(2),
        ]);
        $this->patchJson("/api/tasks/{$this->task->id}/notes/{$oldNote->id}", [
            'body' => 'The author window has expired.',
        ])->assertForbidden();
        $this->deleteJson("/api/tasks/{$this->task->id}/notes/{$plainNoteId}")
            ->assertNoContent();

        $logger = $this->actAs(['tasks.comment', 'tasks.log_time']);
        $timedNoteId = $this->postJson("/api/tasks/{$this->task->id}/notes", [
            'body' => 'Authorized work log',
            'time_minutes' => 25,
        ])->assertCreated()->json('data.id');
        $this->assertSame(25, $this->task->fresh()->actual_minutes);

        $this->patchJson("/api/tasks/{$this->task->id}/notes/{$timedNoteId}", [
            'time_minutes' => 40,
        ])->assertOk();
        $this->assertSame(40, $this->task->fresh()->actual_minutes);

        Sanctum::actingAs($commenter);
        $this->deleteJson("/api/tasks/{$this->task->id}/notes/{$timedNoteId}")
            ->assertForbidden();
        $this->assertDatabaseHas('task_notes', ['id' => $timedNoteId, 'deleted_at' => null]);

        Sanctum::actingAs($logger);
        $this->deleteJson("/api/tasks/{$this->task->id}/notes/{$timedNoteId}")
            ->assertNoContent();
        $this->assertSame(0, $this->task->fresh()->actual_minutes);
        $this->assertNotSame($commenter->id, $otherCommenter->id);
    }

    public function test_timed_note_cannot_move_between_subtasks_without_log_time_permission(): void
    {
        $commenter = $this->actAs(['tasks.comment']);
        $first = $this->subtask('First time bucket');
        $second = $this->subtask('Second time bucket');
        $note = TaskNote::query()->create([
            'task_id' => $this->task->id,
            'subtask_id' => $first->id,
            'body' => 'Existing timed note',
            'time_minutes' => 10,
            'time_logged_by' => $commenter->id,
            'created_by' => $commenter->id,
        ]);

        $this->patchJson("/api/tasks/{$this->task->id}/notes/{$note->id}", [
            'subtask_id' => $second->id,
        ])->assertForbidden();
        $this->assertDatabaseHas('task_notes', [
            'id' => $note->id,
            'subtask_id' => $first->id,
        ]);
    }

    public function test_email_content_is_omitted_without_email_permission_and_the_entire_email_api_is_gated(): void
    {
        Mail::fake();
        $existing = TaskEmail::query()->create([
            'task_id' => $this->task->id,
            'sent_by' => $this->admin->id,
            'to_addresses' => 'client@example.test',
            'subject' => 'Confidential subject',
            'body' => 'Confidential email body',
            'status' => 'logged',
        ]);

        $this->actAs([], false);
        $this->getJson("/api/tasks/{$this->task->id}")
            ->assertOk()
            ->assertJsonMissingPath('data.emails');
        $this->getJson("/api/tasks/{$this->task->id}/emails")
            ->assertForbidden();
        $this->getJson("/api/tasks/{$this->task->id}/emails/{$existing->id}")
            ->assertForbidden();

        $emailUser = $this->actAs(['tasks.email'], false);
        $this->getJson("/api/tasks/{$this->task->id}")
            ->assertOk()
            ->assertJsonPath('data.emails.0.body', 'Confidential email body');
        $this->getJson("/api/tasks/{$this->task->id}/emails")
            ->assertOk()
            ->assertJsonPath('data.0.subject', 'Confidential subject');
        $this->getJson("/api/tasks/{$this->task->id}/emails/{$existing->id}")
            ->assertOk()
            ->assertJsonPath('data.body', 'Confidential email body');

        $this->postJson("/api/tasks/{$this->task->id}/emails", [
            'to_addresses' => ['new-client@example.test'],
            'subject' => 'Clocked out send',
            'body' => 'This should not be sent.',
        ])->assertStatus(409)->assertJsonPath('code', 'CLOCK_IN_REQUIRED');

        TimeSession::query()->create([
            'user_id' => $emailUser->id,
            'clock_in_at' => now(),
        ]);
        $sentId = $this->postJson("/api/tasks/{$this->task->id}/emails", [
            'to_addresses' => ['new-client@example.test'],
            'subject' => 'Authorized send',
            'body' => 'Email permission controls sends too.',
        ])->assertCreated()->json('data.id');
        $this->deleteJson("/api/tasks/{$this->task->id}/emails/{$sentId}")
            ->assertNoContent();
        $this->assertSoftDeleted('task_emails', ['id' => $sentId]);
    }

    private function actAs(array $permissions, bool $clockedIn = true): User
    {
        $this->roleSequence++;
        $role = Role::query()->create([
            'name' => "Task boundary role {$this->roleSequence}",
            'key_name' => "task_boundary_{$this->roleSequence}",
        ]);
        $keys = array_values(array_unique([
            'dashboard.view',
            'tasks.view',
            'time.track',
            ...$permissions,
        ]));
        $role->permissions()->createMany(array_map(
            fn (string $key) => ['permission_key' => $key],
            $keys,
        ));
        $user = User::factory()->create(['role_id' => $role->id]);
        if ($clockedIn) {
            TimeSession::query()->create([
                'user_id' => $user->id,
                'clock_in_at' => now(),
            ]);
        }
        Sanctum::actingAs($user);

        return $user;
    }

    private function taskStatus(string $key): FieldValue
    {
        return FieldValue::query()
            ->where('key_name', $key)
            ->whereHas('field', fn ($query) => $query->where('key_name', 'task_status'))
            ->firstOrFail();
    }

    private function subtask(string $title): TaskSubtask
    {
        return TaskSubtask::query()->create([
            'task_id' => $this->task->id,
            'title' => $title,
            'status_value_id' => $this->taskStatus('pending')->id,
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);
    }
}
