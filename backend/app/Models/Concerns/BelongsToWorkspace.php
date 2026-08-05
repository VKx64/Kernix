<?php

namespace App\Models\Concerns;

use App\Models\Workspace;
use App\Support\CurrentWorkspace;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Scopes a model to the current workspace and stamps new rows with it, so a
 * controller cannot leak another tenant's data by forgetting a where clause.
 */
trait BelongsToWorkspace
{
    public static function bootBelongsToWorkspace(): void
    {
        static::addGlobalScope('workspace', function (Builder $query) {
            $workspaceId = CurrentWorkspace::id();
            if ($workspaceId !== null) {
                $query->where($query->getModel()->qualifyColumn('workspace_id'), $workspaceId);
            }
        });

        static::creating(function ($model) {
            if ($model->workspace_id !== null) {
                return;
            }
            // Parent first: a queued job has no signed-in user, but a task still
            // belongs wherever its project lives.
            $model->workspace_id = $model->workspaceIdFromParent()
                ?? CurrentWorkspace::id()
                ?? Workspace::query()->orderBy('id')->value('id');
        });
    }

    /** Overridden by models that hang off another workspace-scoped record. */
    protected function workspaceIdFromParent(): ?int
    {
        return null;
    }

    public function workspace(): BelongsTo
    {
        return $this->belongsTo(Workspace::class);
    }

    /** @return Builder<static> */
    public static function acrossWorkspaces(): Builder
    {
        return static::query()->withoutGlobalScope('workspace');
    }
}
