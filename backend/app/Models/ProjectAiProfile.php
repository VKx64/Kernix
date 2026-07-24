<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ProjectAiProfile extends DomainModel
{
    protected function casts(): array { return ['approved_at' => 'datetime']; }
    public function project(): BelongsTo { return $this->belongsTo(Project::class); }
    public function approver(): BelongsTo { return $this->belongsTo(User::class, 'approved_by'); }
}
