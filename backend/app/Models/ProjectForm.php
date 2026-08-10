<?php

namespace App\Models;

use App\Models\Concerns\BelongsToWorkspace;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class ProjectForm extends DomainModel
{
    use BelongsToWorkspace, HasFactory, SoftDeletes;

    protected function casts(): array
    {
        return [
            'fields' => 'array',
            'require_email' => 'boolean',
            'auto_convert' => 'boolean',
            'notify' => 'boolean',
            'closes_on' => 'date',
            'slug_rotated_at' => 'datetime',
        ];
    }

    protected function workspaceIdFromParent(): ?int
    {
        return $this->project_id
            ? Project::acrossWorkspaces()->whereKey($this->project_id)->value('workspace_id')
            : null;
    }

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function submissions(): HasMany
    {
        return $this->hasMany(FormSubmission::class);
    }

    /**
     * Frozen onto every submission at receipt time. The converter reads only
     * this, never the live row, so editing a form later never changes how an
     * old submission maps to a task.
     *
     * @return array<string, mixed>
     */
    public function toSnapshot(): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'blurb' => $this->blurb,
            'fields' => $this->fields,
            'task_type_key' => $this->task_type_key,
            'created_by' => $this->created_by,
        ];
    }
}
