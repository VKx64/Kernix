<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Client;
use App\Models\Role;
use App\Models\TimeSession;
use App\Models\User;
use App\Support\DefaultRoles;
use App\Support\PermissionCatalog;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class RbacCoreTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed();
        $this->admin = User::query()->findOrFail(1);
        Sanctum::actingAs($this->admin);
    }

    public function test_catalog_is_the_exact_grouped_assignable_contract_and_seeder_removes_obsolete_admin_grants(): void
    {
        $keys = PermissionCatalog::keys();
        $this->assertCount(49, $keys);
        $this->assertCount(49, array_unique($keys));
        $this->assertCount(13, PermissionCatalog::groups());
        $this->assertNotContains('tasks.delete', $keys);
        $this->assertNotContains('roles.edit', $keys);
        $this->assertSame(['tasks.comment'], PermissionCatalog::requires('tasks.log_time'));
        $this->assertSame(['dashboard.view'], PermissionCatalog::requires('time.view_team'));

        $response = $this->getJson('/api/roles/permissions')->assertOk();
        $this->assertCount(13, $response->json('data'));
        $this->assertCount(49, collect($response->json('data'))->flatMap(fn (array $group) => $group['permissions']));
        $response->assertJsonFragment([
            'key' => 'tasks.assign',
            'requires' => ['tasks.view', 'time.track'],
        ]);

        DB::table('role_permissions')->insert([
            'role_id' => $this->admin->role_id,
            'permission_key' => 'tasks.delete',
        ]);
        $this->seed();

        $stored = DB::table('role_permissions')
            ->where('role_id', $this->admin->role_id)
            ->orderBy('permission_key')
            ->pluck('permission_key')
            ->all();
        $expected = $keys;
        sort($expected);
        $this->assertSame($expected, $stored);
    }

    public function test_default_custom_roles_are_seeded_once_without_overwriting_later_admin_choices(): void
    {
        foreach (DefaultRoles::definitions() as $definition) {
            $this->assertSame([], array_values(array_diff($definition['permissions'], PermissionCatalog::keys())));
            $this->assertSame([], PermissionCatalog::missingDependencies($definition['permissions']));
            $this->assertContains('dashboard.view', $definition['permissions']);

            $role = Role::query()->where('key_name', $definition['key_name'])->firstOrFail();
            $this->assertSame($definition['name'], $role->name);
            $this->assertFalse((bool) $role->is_system);
            $this->assertEqualsCanonicalizing(
                $definition['permissions'],
                $role->permissions()->pluck('permission_key')->all()
            );
        }

        $employee = Role::query()->where('key_name', 'employee_role')->firstOrFail();
        $employee->permissions()->delete();
        $employee->permissions()->create(['permission_key' => 'dashboard.view']);
        $client = Role::query()->where('key_name', 'client_role')->firstOrFail();
        $client->delete();
        $projectManagement = Role::query()->where('key_name', 'project_management_role')->firstOrFail();
        $projectManagement->update(['key_name' => 'project_management_custom']);

        $this->seed();

        $this->assertSame(
            ['dashboard.view'],
            $employee->fresh()->permissions()->pluck('permission_key')->all()
        );
        $this->assertNotNull(Role::withTrashed()->findOrFail($client->id)->deleted_at);
        $this->assertSame(1, DB::table('roles')->where('key_name', 'client_role')->count());
        $this->assertSame(0, DB::table('roles')->where('key_name', 'project_management_role')->count());
        $this->assertSame(1, DB::table('roles')->where('name', 'Project Management Role')->count());
    }

    public function test_role_writes_are_admin_only_and_validate_dashboard_and_dependency_closure(): void
    {
        $this->postJson('/api/roles', [
            'name' => 'No dashboard',
            'permissions' => ['tasks.view'],
        ])->assertUnprocessable()->assertJsonValidationErrors('permissions');

        $this->postJson('/api/roles', [
            'name' => 'Broken task role',
            'permissions' => ['dashboard.view', 'tasks.create'],
        ])->assertUnprocessable()->assertJsonValidationErrors('permissions');

        $role = $this->postJson('/api/roles', [
            'name' => 'Task creator',
            'permissions' => ['dashboard.view', 'time.track', 'tasks.view', 'tasks.create'],
        ])->assertCreated()
            ->assertJsonPath('data.permissions.0', 'dashboard.view')
            ->json('data');

        $viewerRole = $this->roleWith('Role viewer', ['dashboard.view', 'roles.view']);
        Sanctum::actingAs(User::factory()->create(['role_id' => $viewerRole->id]));
        $this->postJson('/api/roles', [
            'name' => 'Escalation attempt',
            'permissions' => ['dashboard.view'],
        ])->assertForbidden();
        $this->deleteJson('/api/roles/'.$role['id'])->assertForbidden();
    }

    public function test_runtime_authorization_and_presented_permissions_reject_corrupt_dependency_grants(): void
    {
        $role = $this->roleWith('Corrupt settings editor', ['dashboard.view', 'settings.edit']);
        $user = User::factory()->create(['role_id' => $role->id]);
        Sanctum::actingAs($user);

        $this->patchJson('/api/settings', ['default_timezone' => 'UTC'])->assertForbidden();
        $this->getJson('/api/bootstrap')
            ->assertOk()
            ->assertJsonPath('data.permissions', ['dashboard.view'])
            ->assertJsonPath('data.user.permissions', ['dashboard.view']);

        $this->getJson('/api/roles/'.$role->id)
            ->assertForbidden();
    }

    public function test_runtime_fails_closed_when_a_custom_role_loses_the_required_dashboard_grant(): void
    {
        $this->assertFalse(PermissionCatalog::allows(['users.view'], 'users.view'));
        $this->assertSame([], PermissionCatalog::effective(['users.view']));

        $role = $this->roleWith('Corrupt role without dashboard', ['users.view']);
        $user = User::factory()->create(['role_id' => $role->id]);
        Sanctum::actingAs($user);

        $this->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('data.permissions', []);
        $this->getJson('/api/users')->assertForbidden();
        $this->getJson('/api/dashboard')->assertForbidden();
        $this->getJson('/api/profile')->assertOk();
        $this->getJson('/api/bootstrap')
            ->assertOk()
            ->assertJsonPath('data.permissions', [])
            ->assertJsonPath('data.fields', [])
            ->assertJsonPath('data.coworkers', [])
            ->assertJsonPath('data.clients', [])
            ->assertJsonPath('data.projects', []);
    }

    public function test_permission_changes_revoke_all_role_sessions_tokens_and_remember_credentials_with_audits(): void
    {
        $role = $this->roleWith('Project editor', ['dashboard.view', 'projects.view', 'projects.edit']);
        $target = User::factory()->create([
            'role_id' => $role->id,
            'remember_token' => str_repeat('a', 60),
        ]);
        DB::table('sessions')->insert([
            'id' => 'role-session',
            'user_id' => $target->id,
            'ip_address' => '127.0.0.1',
            'user_agent' => 'test',
            'payload' => 'test',
            'last_activity' => now()->timestamp,
        ]);
        $token = $target->createToken('test-role-token')->accessToken;

        $this->getJson('/api/roles/'.$role->id)
            ->assertOk()
            ->assertJsonPath('data.affected_users_count', 1);

        $this->patchJson('/api/roles/'.$role->id, [
            'permissions' => ['dashboard.view', 'projects.view'],
        ])->assertOk()
            ->assertJsonPath('data.affected_users_count', 1)
            ->assertJsonPath('data.sessions_revoked', true);

        $this->assertDatabaseMissing('sessions', ['id' => 'role-session']);
        $this->assertDatabaseMissing('personal_access_tokens', ['id' => $token->id]);
        $this->assertNotSame(str_repeat('a', 60), $target->fresh()->remember_token);
        $this->assertDatabaseHas('audit_logs', ['action' => 'role.permissions_changed', 'entity_id' => $role->id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'role.sessions_revoked', 'entity_id' => $role->id]);

        $auditsBeforeNoOp = AuditLog::query()->where('action', 'role.sessions_revoked')->count();
        $this->patchJson('/api/roles/'.$role->id, [
            'permissions' => ['projects.view', 'dashboard.view'],
        ])->assertOk()
            ->assertJsonPath('data.affected_users_count', 0)
            ->assertJsonPath('data.sessions_revoked', false);
        $this->assertSame($auditsBeforeNoOp, AuditLog::query()->where('action', 'role.sessions_revoked')->count());
    }

    public function test_custom_role_reset_migration_is_idempotent_and_revokes_credentials(): void
    {
        $role = $this->roleWith('Legacy role', ['clients.delete', 'roles.edit']);
        $target = User::factory()->create([
            'role_id' => $role->id,
            'remember_token' => str_repeat('b', 60),
        ]);
        DB::table('sessions')->insert([
            'id' => 'legacy-session',
            'user_id' => $target->id,
            'ip_address' => null,
            'user_agent' => null,
            'payload' => 'test',
            'last_activity' => now()->timestamp,
        ]);
        $token = $target->createToken('legacy-role-token')->accessToken;

        $migration = require database_path('migrations/2026_07_14_100000_reset_custom_role_permissions.php');
        $migration->up();

        $this->assertSame(['dashboard.view'], $role->permissions()->pluck('permission_key')->all());
        $this->assertDatabaseMissing('sessions', ['id' => 'legacy-session']);
        $this->assertDatabaseMissing('personal_access_tokens', ['id' => $token->id]);
        $firstRotatedToken = $target->fresh()->remember_token;
        $this->assertNotSame(str_repeat('b', 60), $firstRotatedToken);
        $this->assertDatabaseHas('audit_logs', ['action' => 'role.permissions_reset', 'entity_id' => $role->id]);

        $migration->up();
        $this->assertSame($firstRotatedToken, $target->fresh()->remember_token);
        $this->assertSame(1, AuditLog::query()->where('action', 'role.permissions_reset')->where('entity_id', $role->id)->count());
    }

    public function test_time_endpoints_enforce_own_and_team_permissions(): void
    {
        $role = $this->roleWith('Dashboard only', ['dashboard.view']);
        $user = User::factory()->create(['role_id' => $role->id]);
        $other = User::factory()->create();
        TimeSession::query()->create(['user_id' => $other->id, 'clock_in_at' => now()]);
        Sanctum::actingAs($user);

        $this->getJson('/api/time')->assertForbidden();
        $this->getJson('/api/time/summary')->assertForbidden();
        $this->getJson('/api/time/clocked-users')->assertForbidden();

        $role->permissions()->create(['permission_key' => 'time.track']);
        $user->unsetRelation('role');
        Sanctum::actingAs($user);
        $this->getJson('/api/time')->assertOk();
        $this->getJson('/api/time/summary?user_id='.$other->id)->assertForbidden();
        $this->getJson('/api/time/clocked-users')->assertForbidden();

        $role->permissions()->create(['permission_key' => 'time.view_team']);
        $user->unsetRelation('role');
        Sanctum::actingAs($user);
        $this->getJson('/api/time/clocked-users')->assertOk();
        $this->getJson('/api/time/summary?user_id='.$other->id)->assertOk();
    }

    public function test_dashboard_bootstrap_and_settings_return_only_operational_authorized_data(): void
    {
        $client = Client::query()->create(['name' => 'Available client', 'created_by' => $this->admin->id]);
        $role = $this->roleWith('Settings and team time', [
            'dashboard.view', 'time.view_team', 'settings.view', 'settings.edit',
        ]);
        $user = User::factory()->create(['role_id' => $role->id]);
        TimeSession::query()->create(['user_id' => $this->admin->id, 'clock_in_at' => now()]);
        Sanctum::actingAs($user);

        $this->getJson('/api/bootstrap')
            ->assertOk()
            ->assertJsonPath('data.fields', [])
            ->assertJsonPath('data.coworkers', [])
            ->assertJsonPath('data.projects', [])
            ->assertJsonPath('data.time', null)
            ->assertJsonPath('data.clients.0.id', $client->id);

        $this->getJson('/api/dashboard')
            ->assertOk()
            ->assertJsonPath('data.counts', [])
            ->assertJsonPath('data.team_time.clocked_in_count', 1)
            ->assertJsonMissingPath('data.today_minutes');

        $this->getJson('/api/settings')
            ->assertOk()
            ->assertJsonPath('data.client_options.0.id', $client->id)
            ->assertJsonPath('data.client_options.0.name', 'Available client');
    }

    public function test_business_entity_delete_routes_are_unavailable(): void
    {
        foreach (['clients', 'contacts', 'projects', 'users'] as $resource) {
            $this->deleteJson('/api/'.$resource.'/999999')->assertStatus(405);
        }
        $this->deleteJson('/api/tasks/999999')->assertNotFound();
    }

    /** @param array<int, string> $permissions */
    private function roleWith(string $name, array $permissions): Role
    {
        $role = Role::query()->create([
            'name' => $name,
            'key_name' => str($name)->slug('_').'_'.fake()->unique()->randomNumber(6),
            'is_system' => false,
            'sort_order' => 99,
        ]);
        $role->permissions()->createMany(
            array_map(fn (string $key): array => ['permission_key' => $key], $permissions)
        );

        return $role;
    }
}
