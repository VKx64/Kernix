<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Client;
use App\Models\ExtensionPairingCode;
use App\Models\FieldValue;
use App\Models\Project;
use App\Models\Role;
use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Laravel\Sanctum\PersonalAccessToken;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ExtensionApiTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed();
        $this->admin = User::query()->findOrFail(1);
        config(['app.frontend_url' => 'https://production.example.test']);
    }

    public function test_pairing_codes_are_hashed_single_use_and_issue_limited_expiring_tokens(): void
    {
        Sanctum::actingAs($this->admin);
        $pairing = $this->postJson('/api/extension/pairings')
            ->assertCreated()
            ->assertJsonStructure(['data' => ['code', 'expires_at']]);
        $code = $pairing->json('data.code');
        $stored = ExtensionPairingCode::query()->firstOrFail();

        $this->assertNotSame(str_replace('-', '', $code), $stored->code_hash);
        $this->assertSame(64, strlen($stored->code_hash));
        $this->assertTrue($stored->expires_at->between(now()->addMinutes(9), now()->addMinutes(11)));

        $exchange = $this->postJson('/api/extension/pairings/exchange', [
            'code' => strtolower($code),
            'device_name' => 'Chrome on Windows',
        ])->assertOk()
            ->assertJsonPath('data.user.id', $this->admin->id)
            ->assertJsonPath('data.workspace.origin', 'https://production.example.test');
        $plainToken = $exchange->json('data.token');
        [$tokenId] = explode('|', $plainToken, 2);
        $token = PersonalAccessToken::query()->findOrFail($tokenId);

        $this->assertSame(['extension-api'], $token->abilities);
        $this->assertTrue($token->expires_at->between(now()->addDays(89), now()->addDays(91)));
        $this->assertNotNull($stored->fresh()->redeemed_at);
        $this->postJson('/api/extension/pairings/exchange', [
            'code' => $code,
            'device_name' => 'Replay attempt',
        ])->assertUnprocessable();

        Sanctum::actingAs($this->admin);
        $this->getJson('/api/extension/devices')
            ->assertOk()
            ->assertJsonPath('data.0.id', $token->id)
            ->assertJsonPath('data.0.name', 'Chrome on Windows');

        $audit = AuditLog::query()->where('action', 'extension.pairing.exchange')->firstOrFail();
        $serialized = json_encode($audit->changes_json);
        $this->assertStringNotContainsString($plainToken, $serialized);
        $this->assertStringNotContainsString(str_replace('-', '', $code), $serialized);
    }

    public function test_pairing_rejects_expired_inactive_and_throttled_codes(): void
    {
        Sanctum::actingAs($this->admin);
        $code = $this->postJson('/api/extension/pairings')->assertCreated()->json('data.code');
        ExtensionPairingCode::query()->update(['expires_at' => now()->subMinute()]);
        $this->postJson('/api/extension/pairings/exchange', [
            'code' => $code,
            'device_name' => 'Expired',
        ])->assertUnprocessable();

        $freshCode = $this->postJson('/api/extension/pairings')->assertCreated()->json('data.code');
        $this->admin->update(['status' => 'inactive']);
        $this->postJson('/api/extension/pairings/exchange', [
            'code' => $freshCode,
            'device_name' => 'Inactive',
        ])->assertUnprocessable();

    }

    public function test_pairing_exchange_is_throttled(): void
    {
        foreach (range(1, 5) as $attempt) {
            $this->postJson('/api/extension/pairings/exchange', [
                'code' => sprintf('BADCODE%03d', $attempt),
                'device_name' => 'Throttle',
            ])->assertUnprocessable();
        }
        $this->postJson('/api/extension/pairings/exchange', [
            'code' => 'BADCODE999',
            'device_name' => 'Throttle',
        ])->assertTooManyRequests();
    }

    public function test_extension_token_is_confined_to_extension_routes_and_devices_are_owner_scoped(): void
    {
        $other = User::factory()->create();
        $extension = $this->admin->createToken('Browser extension · Mine', ['extension-api'], now()->addDays(90));
        $otherToken = $other->createToken('Browser extension · Other', ['extension-api'], now()->addDays(90));

        $this->forgetAuthenticatedUser();
        $this->withToken($extension->plainTextToken)
            ->getJson('/api/extension/bootstrap')
            ->assertOk()
            ->assertJsonPath('data.user.id', $this->admin->id);
        $this->withToken($extension->plainTextToken)
            ->getJson('/api/tasks')
            ->assertForbidden();

        Sanctum::actingAs($this->admin);
        $this->deleteJson('/api/extension/devices/'.$otherToken->accessToken->id)->assertNotFound();
        $this->deleteJson('/api/extension/devices/'.$extension->accessToken->id)->assertNoContent();
        $this->assertDatabaseMissing('personal_access_tokens', ['id' => $extension->accessToken->id]);
        $this->assertDatabaseHas('personal_access_tokens', ['id' => $otherToken->accessToken->id]);

        Sanctum::actingAs($this->admin);
        $this->getJson('/api/bootstrap')->assertOk();
    }

    public function test_extension_task_and_time_workflows_reuse_permissions_clock_guards_and_totals(): void
    {
        [$project, $assigned, $otherTask] = $this->tasks();
        $status = FieldValue::query()->where('key_name', 'in_progress')->firstOrFail();
        $token = $this->admin->createToken('Browser extension · Workflow', ['extension-api'], now()->addDays(90));
        $this->forgetAuthenticatedUser();

        $tasks = $this->withToken($token->plainTextToken)
            ->getJson('/api/extension/tasks?search=Assigned')
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.id', $assigned->id);
        $this->assertNotContains($otherTask->id, collect($tasks->json('data'))->pluck('id')->all());

        $this->withToken($token->plainTextToken)
            ->patchJson('/api/extension/tasks/'.$assigned->id.'/status', ['status_value_id' => $status->id])
            ->assertStatus(409)
            ->assertJsonPath('code', 'CLOCK_IN_REQUIRED');

        $this->withToken($token->plainTextToken)
            ->postJson('/api/extension/time/clock-in')
            ->assertOk()
            ->assertJsonPath('data.state', 'working');
        $this->withToken($token->plainTextToken)
            ->patchJson('/api/extension/tasks/'.$assigned->id.'/status', ['status_value_id' => $status->id])
            ->assertOk()
            ->assertJsonPath('data.status.id', $status->id);
        $this->withToken($token->plainTextToken)
            ->postJson('/api/extension/tasks/'.$assigned->id.'/notes', [
                'body' => 'Implemented from the browser companion.',
                'time_minutes' => 25,
            ])->assertCreated()
            ->assertJsonPath('data.time_minutes', 25);
        $this->assertDatabaseHas('tasks', ['id' => $assigned->id, 'actual_minutes' => 25]);

        $this->withToken($token->plainTextToken)
            ->postJson('/api/extension/time/break-start')
            ->assertOk()
            ->assertJsonPath('data.state', 'break');
        $this->withToken($token->plainTextToken)
            ->postJson('/api/extension/time/break-end')
            ->assertOk()
            ->assertJsonPath('data.state', 'working');
        $this->withToken($token->plainTextToken)
            ->postJson('/api/extension/time/clock-out')
            ->assertOk()
            ->assertJsonPath('data.state', 'clocked_out');

        $this->assertDatabaseHas('projects', ['id' => $project->id]);
    }

    public function test_extension_endpoints_fail_closed_for_role_permissions_active_users_and_expired_tokens(): void
    {
        $role = Role::query()->create(['name' => 'Extension reader', 'key_name' => 'extension_reader']);
        $role->permissions()->createMany([
            ['permission_key' => 'tasks.view'],
            ['permission_key' => 'time.track'],
        ]);
        $reader = User::factory()->create(['role_id' => $role->id]);
        $token = $reader->createToken('Browser extension · Reader', ['extension-api'], now()->addDays(90));
        $this->forgetAuthenticatedUser();

        $this->withToken($token->plainTextToken)
            ->getJson('/api/extension/bootstrap')
            ->assertOk()
            ->assertJsonMissing(['tasks.change_status']);
        [$project] = $this->workspace();
        $task = Task::query()->create([
            'project_id' => $project->id,
            'title' => 'Reader task',
            'assignee_user_id' => $reader->id,
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);
        $status = FieldValue::query()->where('key_name', 'complete')->firstOrFail();
        $this->withToken($token->plainTextToken)
            ->patchJson('/api/extension/tasks/'.$task->id.'/status', ['status_value_id' => $status->id])
            ->assertForbidden();
        $this->withToken($token->plainTextToken)
            ->postJson('/api/extension/tasks/'.$task->id.'/notes', ['body' => 'Not allowed'])
            ->assertForbidden();

        $reader->update(['status' => 'inactive']);
        $this->forgetAuthenticatedUser();
        $this->withToken($token->plainTextToken)
            ->getJson('/api/extension/bootstrap')
            ->assertUnauthorized();

        $expired = $this->admin->createToken('Browser extension · Expired', ['extension-api'], now()->subMinute());
        $this->forgetAuthenticatedUser();
        $this->withToken($expired->plainTextToken)
            ->getJson('/api/extension/bootstrap')
            ->assertUnauthorized();
    }

    private function tasks(): array
    {
        [$project] = $this->workspace();
        $assigned = Task::query()->create([
            'project_id' => $project->id,
            'title' => 'Assigned extension task',
            'assignee_user_id' => $this->admin->id,
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);
        $other = User::factory()->create();
        $otherTask = Task::query()->create([
            'project_id' => $project->id,
            'title' => 'Someone else task',
            'assignee_user_id' => $other->id,
            'actual_minutes' => 0,
            'created_by' => $this->admin->id,
        ]);

        return [$project, $assigned, $otherTask];
    }

    private function workspace(): array
    {
        $client = Client::query()->create(['name' => 'Extension client', 'created_by' => $this->admin->id]);
        $project = Project::query()->create([
            'client_id' => $client->id,
            'name' => 'Extension project',
            'created_by' => $this->admin->id,
        ]);

        return [$project, $client];
    }

    private function forgetAuthenticatedUser(): void
    {
        Auth::forgetGuards();
        $this->app['auth']->forgetGuards();
    }
}
