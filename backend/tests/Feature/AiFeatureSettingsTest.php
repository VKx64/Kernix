<?php

namespace Tests\Feature;

use App\Jobs\AuditTaskCompletionProof;
use App\Models\Client;
use App\Models\Project;
use App\Models\SystemSetting;
use App\Models\Task;
use App\Models\TaskCompletionProof;
use App\Models\TimeSession;
use App\Models\User;
use App\Services\AiUsageService;
use App\Services\OpenRouterClient;
use App\Services\TaskCompletionAuditPrompt;
use App\Support\AiFeatures;
use App\Support\TaskStatuses;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AiFeatureSettingsTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        TaskStatuses::flush();
        $this->seed();
        $this->admin = User::query()->findOrFail(1);
        Sanctum::actingAs($this->admin);
    }

    public function test_every_ai_feature_ships_enabled_with_its_default_prompt_on_show(): void
    {
        $response = $this->getJson('/api/settings')->assertOk();
        $features = collect($response->json('data.ai_features'));

        $this->assertSame(AiFeatures::keys(), $features->pluck('key')->all());
        foreach ($features as $feature) {
            $this->assertTrue($feature['enabled'], "{$feature['key']} did not default to enabled.");
            $this->assertSame('', $feature['prompt'], "{$feature['key']} started with a stored prompt.");
            $this->assertNotSame('', trim($feature['default_prompt']), "{$feature['key']} has no built-in prompt to fall back to.");
        }
    }

    public function test_toggles_and_prompts_save_through_the_ai_section(): void
    {
        $this->patchJson('/api/settings/ai', [
            'ai_completion_audit_enabled' => false,
            'ai_completion_audit_prompt' => 'Audit strictly and demand a dated screenshot.',
            'ai_task_creation_prompt' => 'Write terse tasks.',
        ])->assertOk()
            ->assertJsonPath('data.ai_completion_audit_enabled', false)
            ->assertJsonPath('data.ai_completion_audit_prompt', 'Audit strictly and demand a dated screenshot.');

        $settings = SystemSetting::query()->firstOrFail();
        $this->assertFalse(AiFeatures::enabled($settings, AiFeatures::COMPLETION_AUDIT));
        $this->assertTrue(AiFeatures::enabled($settings, AiFeatures::TASK_CREATION));
        $this->assertSame(
            'Audit strictly and demand a dated screenshot.',
            app(TaskCompletionAuditPrompt::class)->system($settings),
        );

        // Clearing the box restores the shipped prompt.
        $this->patchJson('/api/settings/ai', ['ai_completion_audit_prompt' => ''])->assertOk();
        $settings = SystemSetting::query()->firstOrFail();
        $prompt = app(TaskCompletionAuditPrompt::class);
        $this->assertSame($prompt->defaultSystem(), $prompt->system($settings));
    }

    public function test_a_disabled_audit_parks_the_proof_for_a_human_instead_of_calling_the_provider(): void
    {
        SystemSetting::query()->firstOrFail()->update([
            'openrouter_api_key' => 'test-key',
            'openrouter_model' => 'test/model',
            AiFeatures::enabledColumn(AiFeatures::COMPLETION_AUDIT) => false,
        ]);

        $client = Client::query()->create(['name' => 'Toggle client', 'created_by' => $this->admin->id]);
        $project = Project::query()->create(['client_id' => $client->id, 'name' => 'Toggle project', 'created_by' => $this->admin->id]);
        $task = Task::query()->create([
            'project_id' => $project->id,
            'title' => 'Toggle task',
            'status_value_id' => TaskStatuses::id(TaskStatuses::QUALITY_CHECK),
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);
        $proof = TaskCompletionProof::query()->create([
            'task_id' => $task->id,
            'submitted_by' => $this->admin->id,
            'summary' => 'Finished the toggle work and attached the export.',
            'status' => 'pending',
            'ai_state' => 'queued',
        ]);

        $provider = \Mockery::mock(OpenRouterClient::class);
        $provider->shouldNotReceive('structured');

        (new AuditTaskCompletionProof($proof->id))->handle(
            $provider,
            app(TaskCompletionAuditPrompt::class),
            app(AiUsageService::class),
        );

        $proof->refresh();
        $this->assertSame('pending', $proof->status);
        $this->assertTrue($proof->awaitsHumanReview());
        $this->assertStringContainsString('switched off', (string) $proof->ai_message);
        $this->assertSame(TaskStatuses::id(TaskStatuses::QUALITY_CHECK), (int) $task->fresh()->status_value_id);
    }

    public function test_ai_task_creation_is_refused_while_the_feature_is_off(): void
    {
        SystemSetting::query()->firstOrFail()->update([
            AiFeatures::enabledColumn(AiFeatures::TASK_CREATION) => false,
        ]);
        $client = Client::query()->create(['name' => 'Gen client', 'created_by' => $this->admin->id]);
        $project = Project::query()->create([
            'client_id' => $client->id,
            'name' => 'Gen project',
            'created_by' => $this->admin->id,
            'ai_task_creation_enabled' => true,
        ]);
        TimeSession::query()->create(['user_id' => $this->admin->id, 'clock_in_at' => now()]);

        $this->postJson("/api/projects/{$project->id}/ai-task-generations", ['prompt' => 'Plan the launch shoot.'])
            ->assertStatus(409)
            ->assertJsonPath('message', 'AI task creation is switched off for this workspace.');
    }
}
