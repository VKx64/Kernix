<?php

namespace App\Models;

class RolePermission extends DomainModel
{
    public $incrementing = false;

    public $timestamps = false;

    protected $primaryKey = null;

    /**
     * A grant lives in the same workspace as its role. It is stamped from the
     * parent rather than from the current workspace so seeding another tenant
     * cannot mislabel a row.
     */
    protected static function booted(): void
    {
        static::creating(function (RolePermission $permission): void {
            if ($permission->workspace_id !== null || ! $permission->role_id) {
                return;
            }
            $permission->workspace_id = Role::acrossWorkspaces()
                ->withTrashed()
                ->whereKey($permission->role_id)
                ->value('workspace_id');
        });
    }
}
