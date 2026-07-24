<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Client;
use App\Models\Project;
use App\Models\Role;
use App\Models\SystemSetting;
use App\Models\User;
use App\Models\UserInvitation;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class InvitationApiTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed();
        $this->admin = User::query()->findOrFail(1);
        Sanctum::actingAs($this->admin);
        config(['app.frontend_url' => 'https://workspace.example.test']);
    }

    public function test_only_administrators_can_manage_invitations(): void
    {
        [$role, $projects] = $this->workspace();
        $payload = $this->payload('invitee@example.test', $role, $projects);

        Auth::forgetGuards();
        $this->postJson('/api/invitations', $payload)->assertUnauthorized();

        $managerRole = Role::query()->create([
            'name' => 'User manager',
            'key_name' => 'user_manager_invitation_test',
        ]);
        $managerRole->permissions()->createMany([
            ['permission_key' => 'dashboard.view'],
            ['permission_key' => 'users.view'],
            ['permission_key' => 'users.create'],
        ]);
        $manager = User::factory()->create(['role_id' => $managerRole->id]);
        Sanctum::actingAs($manager);

        $this->postJson('/api/invitations', $payload)->assertForbidden();
        $this->getJson('/api/invitations')->assertForbidden();
        $this->assertDatabaseCount('user_invitations', 0);
    }

    public function test_admin_creates_a_hashed_expiring_invitation_and_plain_token_is_returned_once(): void
    {
        [$role, $projects] = $this->workspace();

        $response = $this->postJson('/api/invitations', $this->payload(
            '  NEW.PERSON@Example.Test  ',
            $role,
            $projects,
        ))->assertCreated()
            ->assertJsonPath('data.email', 'new.person@example.test')
            ->assertJsonPath('data.role.id', $role->id)
            ->assertJsonCount(2, 'data.projects');

        $token = $response->json('data.token');
        $this->assertIsString($token);
        $this->assertMatchesRegularExpression('/^[a-f0-9]{64}$/', $token);
        $response->assertJsonPath(
            'data.invite_url',
            'https://workspace.example.test/invite/'.$token,
        );

        $invitation = UserInvitation::query()->firstOrFail();
        $this->assertSame('new.person@example.test', $invitation->email);
        $this->assertNotSame($token, $invitation->token_hash);
        $this->assertSame(
            hash_hmac('sha256', $token, (string) config('app.key')),
            $invitation->token_hash,
        );
        $this->assertEqualsCanonicalizing(
            collect($projects)->pluck('id')->all(),
            $invitation->projects()->pluck('projects.id')->all(),
        );

        $audit = AuditLog::query()->where('action', 'invitation.create')->firstOrFail();
        $serializedAudit = json_encode($audit->changes_json, JSON_THROW_ON_ERROR);
        $this->assertStringNotContainsString($token, $serializedAudit);
        $this->assertStringNotContainsString('invite_url', $serializedAudit);

        $this->getJson('/api/invitations')
            ->assertOk()
            ->assertJsonPath('data.0.status', 'pending')
            ->assertJsonMissingPath('data.0.token')
            ->assertJsonMissingPath('data.0.token_hash')
            ->assertJsonMissingPath('data.0.invite_url');
    }

    public function test_public_acceptance_uses_only_the_invited_role_and_projects_and_is_single_use(): void
    {
        [$role, $projects] = $this->workspace();
        $created = $this->postJson('/api/invitations', $this->payload(
            'member@example.test',
            $role,
            $projects,
        ))->assertCreated();
        $token = $created->json('data.token');
        $invitation = UserInvitation::query()->firstOrFail();

        $this->getJson("/api/invitations/{$token}")
            ->assertOk()
            ->assertHeader('Cache-Control', 'no-store, private')
            ->assertJsonPath('data.email', 'member@example.test')
            ->assertJsonPath('data.role.id', $role->id)
            ->assertJsonCount(2, 'data.projects')
            ->assertJsonMissingPath('data.token')
            ->assertJsonMissingPath('data.invited_by');

        $otherRole = Role::query()->create([
            'name' => 'Injected role',
            'key_name' => 'injected_role',
        ]);
        $this->postJson("/api/invitations/{$token}/accept", [
            'first_name' => 'New',
            'username' => 'new-member',
            'password' => 'SafePassword123!',
            'password_confirmation' => 'SafePassword123!',
            'email' => 'attacker@example.test',
            'role_id' => $otherRole->id,
            'project_ids' => [$projects[0]->id],
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['email', 'role_id', 'project_ids']);
        $this->assertNull($invitation->fresh()->accepted_at);

        $accepted = $this->postJson("/api/invitations/{$token}/accept", [
            'first_name' => 'New',
            'username' => 'new-member',
            'password' => 'SafePassword123!',
            'password_confirmation' => 'SafePassword123!',
        ])->assertCreated()
            ->assertHeader('Cache-Control', 'no-store, private')
            ->assertJsonPath('data.role.id', $role->id)
            ->assertJsonPath('data.imagic_email', 'member@example.test');

        $user = User::query()->where('username', 'new-member')->firstOrFail();
        $this->assertSame($user->id, $accepted->json('data.id'));
        $this->assertSame($role->id, $user->role_id);
        $this->assertSame('member@example.test', $user->imagic_email);
        $this->assertSame('active', $user->status);
        $this->assertTrue(Hash::check('SafePassword123!', $user->password_hash));
        $this->assertSame($user->id, Auth::guard('web')->id());
        $this->assertEqualsCanonicalizing(
            collect($projects)->pluck('id')->all(),
            $user->projects()->pluck('projects.id')->all(),
        );
        foreach ($projects as $project) {
            $this->assertDatabaseHas('project_user', [
                'project_id' => $project->id,
                'user_id' => $user->id,
                'assigned_by' => $this->admin->id,
            ]);
        }

        $this->postJson("/api/invitations/{$token}/accept", [
            'first_name' => 'Replay',
            'username' => 'replay-member',
            'password' => 'SafePassword123!',
            'password_confirmation' => 'SafePassword123!',
        ])->assertStatus(410)
            ->assertJsonPath('message', 'This invitation is invalid or no longer available.');
        $this->assertDatabaseMissing('users', ['username' => 'replay-member']);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'invitation.accept',
            'entity_id' => $invitation->id,
            'user_id' => $user->id,
        ]);
    }

    public function test_invalid_expired_and_revoked_links_share_the_same_failure(): void
    {
        $message = 'This invitation is invalid or no longer available.';
        $invalidToken = str_repeat('f', 64);
        $this->getJson("/api/invitations/{$invalidToken}")
            ->assertStatus(410)
            ->assertJsonPath('message', $message);

        [$role, $projects] = $this->workspace();
        $expired = $this->postJson('/api/invitations', $this->payload(
            'expired@example.test',
            $role,
            $projects,
        ))->assertCreated();
        $expiredToken = $expired->json('data.token');
        UserInvitation::query()->where('email', 'expired@example.test')->update([
            'expires_at' => now()->subMinute(),
        ]);

        $this->getJson("/api/invitations/{$expiredToken}")
            ->assertStatus(410)
            ->assertJsonPath('message', $message);
        $this->postJson("/api/invitations/{$expiredToken}/accept")
            ->assertStatus(410)
            ->assertJsonPath('message', $message);

        $revoked = $this->postJson('/api/invitations', $this->payload(
            'revoked@example.test',
            $role,
            $projects,
        ))->assertCreated();
        $revokedToken = $revoked->json('data.token');
        $revokedId = UserInvitation::query()->where('email', 'revoked@example.test')->value('id');
        $this->postJson("/api/invitations/{$revokedId}/revoke")
            ->assertOk()
            ->assertJsonPath('data.status', 'revoked');

        $this->getJson("/api/invitations/{$revokedToken}")
            ->assertStatus(410)
            ->assertJsonPath('message', $message);
        $this->postJson("/api/invitations/{$revokedToken}/accept")
            ->assertStatus(410)
            ->assertJsonPath('message', $message);
    }

    public function test_acceptance_fails_closed_when_role_project_or_identity_changes(): void
    {
        [$role, $projects] = $this->workspace();
        $projectInvite = $this->postJson('/api/invitations', $this->payload(
            'archived-project@example.test',
            $role,
            [$projects[0]],
        ))->assertCreated();
        $projects[0]->update(['archived_at' => now()]);
        $this->getJson('/api/invitations/'.$projectInvite->json('data.token'))
            ->assertStatus(410);

        $secondRole = Role::query()->create([
            'name' => 'Temporary role',
            'key_name' => 'temporary_invitation_role',
        ]);
        $roleInvite = $this->postJson('/api/invitations', $this->payload(
            'deleted-role@example.test',
            $secondRole,
            [$projects[1]],
        ))->assertCreated();
        $secondRole->delete();
        $this->getJson('/api/invitations/'.$roleInvite->json('data.token'))
            ->assertStatus(410);

        $identityRole = Role::query()->create([
            'name' => 'Identity role',
            'key_name' => 'identity_invitation_role',
        ]);
        $identityInvite = $this->postJson('/api/invitations', $this->payload(
            'claimed@example.test',
            $identityRole,
            [$projects[1]],
        ))->assertCreated();
        User::factory()->create(['personal_email' => 'CLAIMED@EXAMPLE.TEST']);

        $this->postJson('/api/invitations/'.$identityInvite->json('data.token').'/accept', [
            'first_name' => 'Claimed',
            'username' => 'claimed-user',
            'password' => 'SafePassword123!',
            'password_confirmation' => 'SafePassword123!',
        ])->assertUnprocessable()
            ->assertJsonValidationErrors('email');
        $this->assertDatabaseMissing('users', ['username' => 'claimed-user']);
        $this->assertNull(
            UserInvitation::query()->where('email', 'claimed@example.test')->value('accepted_at'),
        );
    }

    public function test_existing_identities_and_active_duplicate_invitations_are_rejected(): void
    {
        [$role, $projects] = $this->workspace();
        $deleted = User::factory()->create(['personal_email' => 'used@example.test']);
        $deleted->delete();

        $this->postJson('/api/invitations', $this->payload(
            'USED@EXAMPLE.TEST',
            $role,
            $projects,
        ))->assertUnprocessable()
            ->assertJsonValidationErrors('email');

        $first = $this->postJson('/api/invitations', $this->payload(
            'duplicate@example.test',
            $role,
            $projects,
        ))->assertCreated();
        $this->postJson('/api/invitations', $this->payload(
            'DUPLICATE@EXAMPLE.TEST',
            $role,
            $projects,
        ))->assertUnprocessable()
            ->assertJsonValidationErrors('email');

        $invitationId = $first->json('data.id');
        $this->postJson("/api/invitations/{$invitationId}/revoke")->assertOk();
        $this->postJson('/api/invitations', $this->payload(
            'duplicate@example.test',
            $role,
            $projects,
        ))->assertCreated();
    }

    public function test_single_client_mode_rejects_projects_outside_the_selected_client(): void
    {
        [$role, $projects, $client] = $this->workspace();
        $otherClient = Client::query()->create([
            'name' => 'Other client',
            'created_by' => $this->admin->id,
        ]);
        $otherProject = Project::query()->create([
            'client_id' => $otherClient->id,
            'name' => 'Other project',
            'created_by' => $this->admin->id,
        ]);
        SystemSetting::query()->findOrFail(1)->update([
            'single_client_mode' => true,
            'single_client_id' => $client->id,
        ]);

        $this->postJson('/api/invitations', $this->payload(
            'wrong-client@example.test',
            $role,
            [$otherProject],
        ))->assertUnprocessable()
            ->assertJsonValidationErrors('project_ids');

        $this->postJson('/api/invitations', $this->payload(
            'right-client@example.test',
            $role,
            [$projects[0]],
        ))->assertCreated();
    }

    /**
     * @return array{Role, array<int, Project>, Client}
     */
    private function workspace(): array
    {
        $role = Role::query()->where('key_name', 'employee_role')->firstOrFail();
        $client = Client::query()->create([
            'name' => 'Invitation client',
            'created_by' => $this->admin->id,
        ]);
        $projects = [
            Project::query()->create([
                'client_id' => $client->id,
                'name' => 'Alpha project',
                'created_by' => $this->admin->id,
            ]),
            Project::query()->create([
                'client_id' => $client->id,
                'name' => 'Beta project',
                'created_by' => $this->admin->id,
            ]),
        ];

        return [$role, $projects, $client];
    }

    /**
     * @param  array<int, Project>  $projects
     * @return array<string, mixed>
     */
    private function payload(string $email, Role $role, array $projects): array
    {
        return [
            'email' => $email,
            'role_id' => $role->id,
            'project_ids' => collect($projects)->pluck('id')->all(),
            'expires_in_days' => 7,
        ];
    }
}
