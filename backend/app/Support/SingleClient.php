<?php

namespace App\Support;

use App\Models\SystemSetting;

class SingleClient
{
    public static function id(): ?int
    {
        $settings = SystemSetting::find(1);

        return $settings?->single_client_mode ? $settings->single_client_id : null;
    }

    public static function enabled(): bool
    {
        return (bool) SystemSetting::find(1)?->single_client_mode;
    }
}
