<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Project;
use App\Models\Role;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Project AI context (the brief and its approved/pending lessons) is manager
 * territory: the design gives no employee a way to reach it, and the
 * projects.manage_ai_memory permission is what is supposed to stand guard.
 * `show()` used to check only `projects.view`, which every employee holds,
 * so any employee could read another manager's approved lessons by hitting
 * the route directly even with the UI entry point hidden.
 */
class ProjectMemoryAccessTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed();
        $this->admin = User::query()->findOrFail(1);
    }

    private function project(): Project
    {
        $client = Client::query()->create([
            'name' => 'Memory access client',
            'created_by' => $this->admin->id,
        ]);

        return Project::query()->create([
            'client_id' => $client->id,
            'name' => 'Memory access project',
            'created_by' => $this->admin->id,
        ]);
    }

    /** @param array<int, string> $permissions */
    private function actorWith(array $permissions): User
    {
        $role = Role::query()->create([
            'name' => 'Memory access role '.str()->random(8),
            'key_name' => 'memory_access_role_'.str()->lower(str()->random(12)),
            'is_system' => false,
            'sort_order' => 99,
        ]);
        $role->permissions()->createMany(array_map(
            fn (string $permission): array => ['permission_key' => $permission],
            $permissions,
        ));

        return User::factory()->create(['role_id' => $role->id]);
    }

    public function test_an_employee_with_only_projects_view_is_refused_project_ai_context(): void
    {
        $project = $this->project();
        $employee = $this->actorWith(['dashboard.view', 'projects.view']);
        Sanctum::actingAs($employee);

        $response = $this->getJson('/api/projects/'.$project->id.'/ai-memory');

        $response->assertForbidden();
    }

    public function test_a_manager_with_manage_ai_memory_can_read_project_ai_context(): void
    {
        $project = $this->project();
        $manager = $this->actorWith(['dashboard.view', 'projects.view', 'projects.manage_ai_memory']);
        Sanctum::actingAs($manager);

        $response = $this->getJson('/api/projects/'.$project->id.'/ai-memory');

        $response->assertOk();
    }

    /**
     * The sibling mutation routes on the same controller were already
     * gated correctly; this pins that down alongside the fix above so a
     * future change can't reopen either hole unnoticed.
     */
    public function test_sibling_ai_memory_routes_also_require_manage_ai_memory(): void
    {
        $project = $this->project();
        $employee = $this->actorWith(['dashboard.view', 'projects.view']);
        Sanctum::actingAs($employee);

        $this->postJson('/api/projects/'.$project->id.'/ai-memory/brief-draft')->assertForbidden();
        $this->patchJson('/api/projects/'.$project->id.'/ai-memory/brief', ['brief' => 'x'])->assertForbidden();
    }
}
