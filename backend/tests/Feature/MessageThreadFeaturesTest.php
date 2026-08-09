<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Project;
use App\Models\Role;
use App\Models\SystemSetting;
use App\Models\Task;
use App\Models\TaskNote;
use App\Models\TimeSession;
use App\Models\User;
use App\Services\OpenRouterClient;
use App\Support\TaskStatuses;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\TestCase;

class MessageThreadFeaturesTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $teammate;

    private Task $task;

    private TaskNote $root;

    private TaskNote $reply;

    protected function setUp(): void
    {
        parent::setUp();

        TaskStatuses::flush();
        $this->seed();
        $this->admin = User::query()->findOrFail(1);
        Sanctum::actingAs($this->admin);
        TimeSession::query()->create(['user_id' => $this->admin->id, 'clock_in_at' => now()]);
        SystemSetting::query()->firstOrFail()->update([
            'openrouter_api_key' => 'test-key',
            'openrouter_model' => 'test/model',
        ]);

        $client = Client::query()->create(['name' => 'Thread client', 'created_by' => $this->admin->id]);
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

        $response = $this->postJson('/api/messages', [
            'task_id' => $this->task->id,
            'recipient_id' => $this->teammate->id,
            'body' => 'Can you take the studio booking?',
        ])->assertCreated();
        $this->root = TaskNote::query()->findOrFail($response->json('data.id'));
        $this->reply = TaskNote::query()->findOrFail($response->json('data.messages.0.id'));
    }

    public function test_a_reaction_can_be_added_and_toggled_off(): void
    {
        $response = $this->postJson("/api/messages/{$this->root->id}/notes/{$this->reply->id}/reactions", ['emoji' => '👍'])
            ->assertOk();

        $reactions = collect($response->json('data.messages.0.reactions'));
        $this->assertSame(1, $reactions->firstWhere('emoji', '👍')['count']);
        $this->assertTrue($reactions->firstWhere('emoji', '👍')['mine']);
        $this->assertDatabaseHas('task_note_reactions', [
            'task_note_id' => $this->reply->id,
            'user_id' => $this->admin->id,
            'emoji' => '👍',
        ]);

        $response = $this->postJson("/api/messages/{$this->root->id}/notes/{$this->reply->id}/reactions", ['emoji' => '👍'])
            ->assertOk();

        $reactions = collect($response->json('data.messages.0.reactions'));
        $this->assertNull($reactions->firstWhere('emoji', '👍'));
        $this->assertDatabaseMissing('task_note_reactions', [
            'task_note_id' => $this->reply->id,
            'user_id' => $this->admin->id,
            'emoji' => '👍',
        ]);
    }

    public function test_a_reaction_is_rejected_for_someone_who_is_not_a_participant(): void
    {
        $outsider = User::factory()->create(['role_id' => $this->admin->role_id]);
        Sanctum::actingAs($outsider);
        TimeSession::query()->create(['user_id' => $outsider->id, 'clock_in_at' => now()]);

        $this->postJson("/api/messages/{$this->root->id}/notes/{$this->reply->id}/reactions", ['emoji' => '👍'])
            ->assertStatus(404);
    }

    public function test_a_reaction_is_rejected_for_a_note_in_another_conversation(): void
    {
        $other = $this->postJson('/api/messages', [
            'task_id' => $this->task->id,
            'recipient_id' => $this->teammate->id,
            'body' => 'A separate thread entirely.',
        ])->assertCreated();
        $otherNoteId = $other->json('data.messages.0.id');

        $this->postJson("/api/messages/{$this->root->id}/notes/{$otherNoteId}/reactions", ['emoji' => '👍'])
            ->assertStatus(404);
    }

    public function test_summary_action_and_reply_ai_kinds_return_their_shapes(): void
    {
        $this->fakeStructured(['summary' => 'Casey is picking up the studio booking.']);
        $this->postJson("/api/messages/{$this->root->id}/ai", ['kind' => 'summary'])
            ->assertOk()
            ->assertJsonPath('data.summary', 'Casey is picking up the studio booking.');

        $this->fakeStructured(['items' => [['title' => 'Book the studio'], ['title' => 'Confirm the date']]]);
        $this->postJson("/api/messages/{$this->root->id}/ai", ['kind' => 'actions'])
            ->assertOk()
            ->assertJsonCount(2, 'data.items')
            ->assertJsonPath('data.items.0.title', 'Book the studio');

        $this->fakeStructured(['reply' => 'Sounds good, I will handle the booking.']);
        $this->postJson("/api/messages/{$this->root->id}/ai", ['kind' => 'reply'])
            ->assertOk()
            ->assertJsonPath('data.reply', 'Sounds good, I will handle the booking.');
    }

    /** @param array<string, mixed> $output */
    private function fakeStructured(array $output): void
    {
        $client = Mockery::mock(OpenRouterClient::class);
        $client->shouldReceive('structured')->once()->andReturn([
            'output' => $output,
            'cost_usd' => 0.0,
            'actual_model' => 'test/model',
        ]);
        $this->app->instance(OpenRouterClient::class, $client);
    }
}
