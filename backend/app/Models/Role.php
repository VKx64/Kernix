<?php

namespace App\Models;

use App\Models\Concerns\BelongsToWorkspace;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A role belongs to one workspace. Seeding and migrating both have to write
 * roles for a workspace that is not the current one, so those paths go through
 * `Role::acrossWorkspaces()` and set `workspace_id` explicitly.
 */
class Role extends DomainModel
{
    use BelongsToWorkspace, SoftDeletes;

    protected function casts(): array
    {
        return ['is_system' => 'boolean'];
    }

    public function permissions(): HasMany
    {
        return $this->hasMany(RolePermission::class);
    }

    /**
     * The legacy `users.role_id` column, which is still the fallback for a
     * membership that carries no role of its own.
     */
    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }
}
