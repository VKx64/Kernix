<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Role;
use App\Models\User;
use App\Models\Workspace;
use App\Support\CurrentWorkspace;
use App\Support\WorkspaceProvisioner;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Roles became per-workspace. Two things have to hold for that to be safe: no
 * existing account may lose a permission on the way through, and no workspace
 * may see another's roles, people or work.
 *
 * The first is the one worth the most care. A migration that silently drops a
 * permission does not fail loudly — it just quietly stops someone doing their
 * job, and nobody finds out until they try.
 */
class WorkspaceScopingTest extends TestCase
{
    use RefreshDatabase;

    private function seedWorkspace(string $name): Workspace
    {
        $owner = User::factory()->create();

        return WorkspaceProvisioner::provision($owner, $name);
    }

    public function test_every_seeded_account_keeps_the_permissions_it_had(): void
    {
        $this->seed(\Database\Seeders\DatabaseSeeder::class);

        $before = User::query()->orderBy('id')->get()
            ->mapWithKeys(fn (User $user) => [$user->id => $user->permissions()])
            ->all();

        $this->assertNotEmpty($before, 'The seeder produced no users to compare.');

        // Re-resolving through the pivot must land on the same answer.
        $after = User::query()->orderBy('id')->get()
            ->mapWithKeys(function (User $user) {
                $user->unsetRelation('role');

                return [$user->id => $user->permissions()];
            })
            ->all();

        foreach ($before as $id => $permissions) {
            sort($permissions);
            $now = $after[$id];
            sort($now);
            $this->assertSame($permissions, $now, "User {$id} lost or gained permissions.");
        }
    }

    public function test_the_administrator_of_one_workspace_is_nobody_in_another(): void
    {
        $first = $this->seedWorkspace('Northwind');
        $second = $this->seedWorkspace('Kestrel');
        $owner = $first->members()->first();
        $this->assertNotNull($owner);

        $here = CurrentWorkspace::use($first->id, fn () => $owner->fresh()->isAdmin());
        $there = CurrentWorkspace::use($second->id, fn () => $owner->fresh()->isAdmin());

        $this->assertTrue($here, 'The founder should administer the workspace they made.');
        $this->assertFalse($there, 'Founding one workspace must not grant rights in another.');
    }

    public function test_roles_of_one_workspace_are_invisible_from_another(): void
    {
        $first = $this->seedWorkspace('Northwind');
        $second = $this->seedWorkspace('Kestrel');

        $mine = CurrentWorkspace::use($first->id, fn () => Role::query()->pluck('id')->all());
        $theirs = CurrentWorkspace::use($second->id, fn () => Role::query()->pluck('id')->all());

        $this->assertNotEmpty($mine);
        $this->assertNotEmpty($theirs);
        $this->assertEmpty(array_intersect($mine, $theirs), 'Two workspaces shared a role row.');
    }

    public function test_one_workspace_cannot_read_another_workspaces_records(): void
    {
        $first = $this->seedWorkspace('Northwind');
        $second = $this->seedWorkspace('Kestrel');

        CurrentWorkspace::use($first->id, fn () => Client::query()->create(['name' => 'Only in Northwind']));

        $strangerSees = CurrentWorkspace::use($second->id, fn () => Client::query()->where('name', 'Only in Northwind')->count());
        $ownerSees = CurrentWorkspace::use($first->id, fn () => Client::query()->where('name', 'Only in Northwind')->count());

        $this->assertSame(0, $strangerSees, 'A workspace read another tenant’s client.');
        $this->assertSame(1, $ownerSees);
    }
}
