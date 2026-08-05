<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Project;
use App\Models\Role;
use App\Models\Task;
use App\Models\TimeSession;
use App\Models\User;
use App\Support\TaskStatuses;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class MessageComposerApiTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $teammate;

    private Task $task;

    protected function setUp(): void
    {
        parent::setUp();

        TaskStatuses::flush();
        $this->seed();
        $this->admin = User::query()->findOrFail(1);
        Sanctum::actingAs($this->admin);
        TimeSession::query()->create(['user_id' => $this->admin->id, 'clock_in_at' => now()]);

        $client = Client::query()->create(['name' => 'Composer client', 'created_by' => $this->admin->id]);
        $project = Project::query()->create([
            'client_id' => $client->id,
            'name' => 'Launch film',
            'created_by' => $this->admin->id,
        ]);
        $this->task = Task::query()->create([
            'project_id' => $project->id,
            'title' => 'Book the studio',
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);
        $this->teammate = User::factory()->create([
            'first_name' => 'Casey',
            'last_name' => 'Reyes',
            'role_id' => Role::query()->where('key_name', 'employee_role')->value('id'),
            'status' => 'active',
        ]);
    }

    public function test_recipients_lists_other_active_people(): void
    {
        $response = $this->getJson('/api/messages/recipients')->assertOk();

        $ids = array_column($response->json('data'), 'id');
        $this->assertContains($this->teammate->id, $ids);
        $this->assertNotContains($this->admin->id, $ids);
    }

    public function test_recipients_omits_archived_people(): void
    {
        $this->teammate->update(['archived_at' => now(), 'status' => 'archived']);

        $ids = array_column($this->getJson('/api/messages/recipients')->assertOk()->json('data'), 'id');
        $this->assertNotContains($this->teammate->id, $ids);
    }

    public function test_a_conversation_can_be_started_with_a_person(): void
    {
        $response = $this->postJson('/api/messages', [
            'task_id' => $this->task->id,
            'recipient_id' => $this->teammate->id,
            'body' => 'Can you take the studio booking?',
        ])->assertCreated();

        $conversationId = $response->json('data.id');
        $this->assertDatabaseHas('task_notes', [
            'id' => $conversationId,
            'conversation_id' => $conversationId,
            'task_id' => $this->task->id,
            'assigned_user_id' => $this->teammate->id,
            'created_by' => $this->admin->id,
            'is_message' => true,
        ]);

        Sanctum::actingAs($this->teammate);
        $this->getJson('/api/messages')
            ->assertOk()
            ->assertJsonPath('data.0.id', $conversationId);
    }

    public function test_a_conversation_cannot_be_started_with_yourself(): void
    {
        $this->postJson('/api/messages', [
            'task_id' => $this->task->id,
            'recipient_id' => $this->admin->id,
            'body' => 'Talking to myself.',
        ])->assertStatus(422);
    }

    public function test_starting_a_conversation_needs_the_comment_permission(): void
    {
        Sanctum::actingAs($this->teammate);
        TimeSession::query()->create(['user_id' => $this->teammate->id, 'clock_in_at' => now()]);
        $role = Role::query()->findOrFail($this->teammate->role_id);
        $role->permissions()->where('permission_key', 'tasks.comment')->delete();

        $this->postJson('/api/messages', [
            'task_id' => $this->task->id,
            'recipient_id' => $this->admin->id,
            'body' => 'Should not land.',
        ])->assertForbidden();
    }
}
