<?php

namespace App\Models;

class SystemSetting extends DomainModel
{
    public $incrementing = false;

    protected $hidden = ['smtp_password', 's3_access_key', 's3_secret_key'];

    protected function casts(): array
    {
        return [
            's3_use_path_style' => 'boolean',
            'single_client_mode' => 'boolean',
            'smtp_password' => 'encrypted',
            's3_access_key' => 'encrypted',
            's3_secret_key' => 'encrypted',
        ];
    }
}
