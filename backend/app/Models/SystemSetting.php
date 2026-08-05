<?php

namespace App\Models;

use App\Support\AiFeatures;

class SystemSetting extends DomainModel
{
    public $incrementing = false;

    protected $hidden = ['smtp_password', 's3_access_key', 's3_secret_key', 'openrouter_api_key'];

    protected function casts(): array
    {
        $features = [];
        foreach (AiFeatures::keys() as $feature) {
            $features[AiFeatures::enabledColumn($feature)] = 'boolean';
        }

        return $features + [
            's3_use_path_style' => 'boolean',
            'single_client_mode' => 'boolean',
            'smtp_password' => 'encrypted',
            's3_access_key' => 'encrypted',
            's3_secret_key' => 'encrypted',
            'openrouter_api_key' => 'encrypted',
            'ai_monthly_budget_usd' => 'decimal:4',
            'ai_max_output_tokens' => 'integer',
            'ai_request_timeout_seconds' => 'integer',
            'ai_inactivity_hours' => 'integer',
        ];
    }
}
