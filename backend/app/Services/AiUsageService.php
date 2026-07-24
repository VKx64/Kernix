<?php

namespace App\Services;

use App\Models\AiUsageEvent;
use App\Models\SystemSetting;

class AiUsageService
{
    public function spentThisMonth(): float
    {
        return (float) AiUsageEvent::query()->where('created_at', '>=', now()->startOfMonth())->sum('cost_usd');
    }

    public function assertAvailable(SystemSetting $settings): void
    {
        abort_if($this->spentThisMonth() >= (float) $settings->ai_monthly_budget_usd, 409, 'The monthly AI budget has been reached.');
    }

    /** @param array<string, mixed> $result */
    public function record(string $feature, string $sourceType, ?int $sourceId, array $result, ?int $projectId = null, ?int $userId = null): AiUsageEvent
    {
        $attributes = ['source_type' => $sourceType, 'source_id' => $sourceId];
        $values =
            [
                'feature' => $feature,
                'project_id' => $projectId,
                'user_id' => $userId,
                'external_generation_id' => $result['generation_id'] ?? null,
                'model' => $result['actual_model'] ?? null,
                'prompt_tokens' => $result['prompt_tokens'] ?? null,
                'completion_tokens' => $result['completion_tokens'] ?? null,
                'total_tokens' => $result['total_tokens'] ?? null,
                'cost_usd' => $result['cost_usd'] ?? 0,
                'status' => 'succeeded',
            ];

        return $sourceId === null
            ? AiUsageEvent::query()->create($attributes + $values)
            : AiUsageEvent::query()->updateOrCreate($attributes, $values);
    }
}
