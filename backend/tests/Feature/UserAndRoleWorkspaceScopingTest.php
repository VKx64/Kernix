<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\CurrentWorkspace;
use App\Support\WorkspaceProvisioner;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Reproduces the cross-tenant leak found in production: a brand-new account
 * registers, onboards into its own workspace, and Settings > Users still
 * listed every seeded workspace's people because the users index carried no
 * workspace filter at all. Settings > Roles happened to look fine only
 * because `Role` already carries the workspace global scope.
 */
class UserAndRoleWorkspaceScopingTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        CurrentWorkspace::reset();
    }

    private function onboardedAdmin(string $name = 'New Owner'): User
    {
        // Mirrors the real registration path (RegistrationController::
        // registerWithoutWorkspace / WorkspaceController::store during
        // onboarding): a blank role_id and no automatic workspace join, so
        // the account starts genuinely workspace-less before provisioning
        // its own.
        $owner = User::withoutAutomaticWorkspace(fn () => User::factory()->create(['role_id' => null]));
        $workspace = WorkspaceProvisioner::provision($owner, $name.' workspace');
        $owner->forceFill(['active_workspace_id' => $workspace->id])->save();

        return $owner->fresh();
    }

    public function test_a_freshly_onboarded_workspace_only_sees_its_own_users(): void
    {
        $this->seed(\Database\Seeders\DatabaseSeeder::class);
        $newOwner = $this->onboardedAdmin();
        Sanctum::actingAs($newOwner);

        $response = $this->getJson('/api/users?per_page=all')->assertOk();

        $ids = collect($response->json('data'))->pluck('id')->all();
        $this->assertSame([$newOwner->id], $ids, 'The new workspace saw accounts that are not its members.');
    }

    public function test_a_freshly_onboarded_workspace_only_sees_its_own_roles(): void
    {
        $this->seed(\Database\Seeders\DatabaseSeeder::class);
        $newOwner = $this->onboardedAdmin();
        Sanctum::actingAs($newOwner);

        $response = $this->getJson('/api/roles?per_page=all')->assertOk();

        $names = collect($response->json('data'))->pluck('name')->sort()->values()->all();
        $this->assertSame(
            ['Administrator', 'Client Role', 'Employee Role', 'Project Management Role'],
            $names,
            'The new workspace saw roles from another tenant.',
        );

        $admin = collect($response->json('data'))->firstWhere('key', 'admin');
        $this->assertSame(1, $admin['users_count'], 'The administrator role reported the wrong member count.');
    }

    public function test_a_workspace_admin_cannot_fetch_another_workspaces_user_by_id(): void
    {
        $this->seed(\Database\Seeders\DatabaseSeeder::class);
        $seededAdmin = User::query()->findOrFail(1);
        $newOwner = $this->onboardedAdmin();
        Sanctum::actingAs($newOwner);

        $this->getJson('/api/users/'.$seededAdmin->id)->assertNotFound();
    }

    public function test_a_workspace_admin_cannot_activate_or_read_another_workspace_by_guessing_its_id(): void
    {
        $this->seed(\Database\Seeders\DatabaseSeeder::class);
        $seededWorkspaceId = 1;
        $newOwner = $this->onboardedAdmin();
        Sanctum::actingAs($newOwner);

        $this->getJson('/api/workspaces')->assertOk()->assertJsonCount(1, 'data');
        $this->postJson("/api/workspaces/{$seededWorkspaceId}/activate")->assertForbidden();
        $this->getJson("/api/workspaces/{$seededWorkspaceId}/members")->assertNotFound();
    }

    public function test_an_admin_adding_a_teammate_lands_them_in_the_admins_own_workspace(): void
    {
        $this->seed(\Database\Seeders\DatabaseSeeder::class);
        $newOwner = $this->onboardedAdmin();
        $ownWorkspaceId = $newOwner->active_workspace_id;
        Sanctum::actingAs($newOwner);

        $adminRoleId = \App\Models\Role::query()->where('key_name', 'admin')->firstOrFail()->id;
        $response = $this->postJson('/api/users', [
            'role_id' => $adminRoleId,
            'username' => 'teammate@example.test',
            'password' => 'password123',
            'password_confirmation' => 'password123',
            'first_name' => 'Team',
            'last_name' => 'Mate',
            'imagic_email' => 'teammate@example.test',
        ])->assertCreated();

        $teammate = User::query()->findOrFail($response->json('data.id'));
        $this->assertTrue(
            $teammate->workspaces()->whereKey($ownWorkspaceId)->exists(),
            'The new teammate did not land in the admin\'s own workspace.',
        );
        $this->assertFalse(
            $teammate->workspaces()->whereKey(1)->exists(),
            'The new teammate was attached to the unrelated seeded workspace.',
        );
    }
}
