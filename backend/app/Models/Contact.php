<?php

namespace App\Models;

use App\Models\Concerns\BelongsToWorkspace;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class Contact extends DomainModel
{
    use BelongsToWorkspace, SoftDeletes;

    protected function casts(): array
    {
        return ['archived_at' => 'datetime'];
    }

    protected function workspaceIdFromParent(): ?int
    {
        return $this->client_id
            ? Client::acrossWorkspaces()->whereKey($this->client_id)->value('workspace_id')
            : null;
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }
}
