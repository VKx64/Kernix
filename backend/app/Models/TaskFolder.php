<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class TaskFolder extends DomainModel
{
    /**
     * How deep the tree may go, counting the top level as 1. Folders are a
     * navigation aid rather than a filesystem, and every extra level costs
     * indentation on screens that are already dense.
     */
    public const MAX_DEPTH = 5;

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function tasks(): HasMany
    {
        return $this->hasMany(Task::class);
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(self::class, 'parent_id');
    }

    /** Every folder in this folder's project, in one query, for tree walking. */
    public function siblingsAndDescendantsSource(): Collection
    {
        return self::query()->where('project_id', $this->project_id)->get();
    }

    /**
     * The chain from the top level down to this folder, nearest ancestor last.
     *
     * Walks a pre-loaded set rather than the database so a caller checking many
     * folders does not issue a query per level. The visited guard means a cycle
     * introduced outside the app stops the walk instead of hanging it.
     *
     * @param  Collection<int, self>|null  $pool
     * @return array<int, self>
     */
    public function ancestors(?Collection $pool = null): array
    {
        $byId = ($pool ?? $this->siblingsAndDescendantsSource())->keyBy('id');
        $chain = [];
        $visited = [$this->id => true];
        $current = $byId->get($this->parent_id);
        while ($current instanceof self && ! isset($visited[$current->id])) {
            $visited[$current->id] = true;
            array_unshift($chain, $current);
            $current = $byId->get($current->parent_id);
        }

        return $chain;
    }

    /** 1 for a top-level folder, 2 for a folder inside it, and so on. */
    public function depth(?Collection $pool = null): int
    {
        return count($this->ancestors($pool)) + 1;
    }

    /**
     * Ids of every folder below this one, at any level.
     *
     * @param  Collection<int, self>|null  $pool
     * @return array<int, int>
     */
    public function descendantIds(?Collection $pool = null): array
    {
        $all = $pool ?? $this->siblingsAndDescendantsSource();
        $childrenByParent = $all->groupBy('parent_id');
        $ids = [];
        $queue = [$this->id];
        while ($queue !== []) {
            $parentId = array_shift($queue);
            foreach ($childrenByParent->get($parentId, collect()) as $child) {
                if (in_array((int) $child->id, $ids, true)) {
                    continue;
                }
                $ids[] = (int) $child->id;
                $queue[] = $child->id;
            }
        }

        return $ids;
    }

    /** The tallest branch under this folder, counting itself as 1. */
    public function subtreeHeight(?Collection $pool = null): int
    {
        $all = $pool ?? $this->siblingsAndDescendantsSource();
        $childrenByParent = $all->groupBy('parent_id');
        $height = 1;
        $level = [$this->id];
        $seen = [$this->id => true];
        while ($level !== []) {
            $next = [];
            foreach ($level as $parentId) {
                foreach ($childrenByParent->get($parentId, collect()) as $child) {
                    if (isset($seen[$child->id])) {
                        continue;
                    }
                    $seen[$child->id] = true;
                    $next[] = $child->id;
                }
            }
            if ($next !== []) {
                $height++;
            }
            $level = $next;
        }

        return $height;
    }
}
