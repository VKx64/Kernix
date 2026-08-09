<?php

namespace App\Models;

use App\Support\WorkspaceFeatures;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Workspace extends DomainModel
{
    use SoftDeletes;

    protected function casts(): array
    {
        $features = [];
        foreach (WorkspaceFeatures::keys() as $feature) {
            $features[WorkspaceFeatures::enabledColumn($feature)] = 'boolean';
        }

        return $features;
    }

    /** The pivot carries the role each member holds inside this workspace. */
    public function members(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'workspace_user')->withPivot('role_id')->withTimestamps();
    }

    public function roles(): HasMany
    {
        return $this->hasMany(Role::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function clients(): HasMany
    {
        return $this->hasMany(Client::class);
    }

    public function projects(): HasMany
    {
        return $this->hasMany(Project::class);
    }

    public function tasks(): HasMany
    {
        return $this->hasMany(Task::class);
    }

    /**
     * @return array<string, mixed>
     */
    public function toSummary(bool $active = false, ?int $memberCount = null): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'slug' => $this->slug,
            'active' => $active,
            'member_count' => $memberCount,
            'created_at' => optional($this->created_at)->toIso8601String(),
        ];
    }
}
