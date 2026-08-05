<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An employee asking to be put on a task they are not assigned to. Work is
 * restricted to your own assignments, so this is the sanctioned way to pick up
 * something unexpected without a manager having to notice it first.
 */
class TaskWorkRequest extends DomainModel
{
    public const PENDING = 'pending';

    public const APPROVED = 'approved';

    public const DECLINED = 'declined';

    public const WITHDRAWN = 'withdrawn';

    protected function casts(): array
    {
        return [
            'decided_at' => 'datetime',
        ];
    }

    public function task(): BelongsTo
    {
        return $this->belongsTo(Task::class);
    }

    public function requester(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requester_user_id');
    }

    public function decider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'decided_by');
    }

    public function isPending(): bool
    {
        return $this->status === self::PENDING;
    }

    /**
     * @return array<string, mixed>
     */
    public function toSummary(?array $requester = null, ?array $decider = null): array
    {
        return [
            'id' => $this->id,
            'task_id' => $this->task_id,
            'reason' => $this->reason,
            'status' => $this->status,
            'requester' => $requester,
            'decider' => $decider,
            'decision_reason' => $this->decision_reason,
            'decided_at' => $this->decided_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
