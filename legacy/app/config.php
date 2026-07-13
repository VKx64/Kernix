<?php
/**
 * Application configuration.
 *
 * Runtime-specific values come from environment variables so the same source
 * can run in Docker, cPanel, or another PHP host without storing credentials.
 */

$env = static function (string $key, $default = null) {
    $value = getenv($key);
    return $value === false ? $default : $value;
};

$envBool = static function (string $key, bool $default = false) use ($env): bool {
    $value = $env($key, null);
    if ($value === null || $value === '') return $default;
    return filter_var($value, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? $default;
};

// ----- Database -----
define('DB_HOST',    (string)$env('DB_HOST', 'db'));
define('DB_PORT',    (int)$env('DB_PORT', 3306));
define('DB_NAME',    (string)$env('DB_NAME', 'production'));
define('DB_USER',    (string)$env('DB_USER', 'production'));
define('DB_PASS',    (string)$env('DB_PASSWORD', 'production_local_password'));
define('DB_CHARSET', (string)$env('DB_CHARSET', 'utf8mb4'));

// ----- Application -----
$appBase = trim((string)$env('APP_BASE', ''));
if ($appBase === '/') {
    $appBase = '';
} elseif ($appBase !== '') {
    $appBase = '/' . trim($appBase, '/');
}

define('APP_NAME',     (string)$env('APP_NAME', 'Kernix'));
define('APP_URL',      rtrim((string)$env('APP_URL', 'http://localhost:8080'), '/'));
define('APP_BASE',     $appBase);
define('APP_ENV',      (string)$env('APP_ENV', 'development'));
define('APP_DEBUG',    $envBool('APP_DEBUG', APP_ENV === 'development'));
define('APP_TIMEZONE', (string)$env('APP_TIMEZONE', 'Asia/Manila'));

// ----- Session -----
// Retained so existing legacy sessions remain valid after the visual rebrand.
define('SESSION_NAME',     (string)$env('SESSION_NAME', 'imagicprod_session'));
define('SESSION_LIFETIME', (int)$env('SESSION_LIFETIME', 60 * 60 * 8));

// ----- Security -----
define('CSRF_TOKEN_KEY',   '_csrf');
define('PASSWORD_MIN_LEN', 8);

// ----- Uploads -----
define('UPLOAD_MAX_BYTES', 25 * 1024 * 1024);
define('UPLOAD_ALLOWED_MIME', [
    'image/jpeg','image/png','image/gif','image/webp','image/svg+xml',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain','text/csv',
]);

// ----- Paths -----
define('BASE_PATH',    dirname(__DIR__));
define('VIEWS_PATH',   BASE_PATH . '/views');
define('MODULES_PATH', BASE_PATH . '/modules');
define('UPLOAD_PATH',  BASE_PATH . '/uploads');
// Backward-compatible alias used by the email attachment handler.
define('UPLOADS_PATH', UPLOAD_PATH);
define('ASSETS_URL',   APP_BASE . '/assets');

// ----- Error reporting -----
if (APP_DEBUG) {
    error_reporting(E_ALL);
    ini_set('display_errors', '1');
} else {
    error_reporting(E_ALL & ~E_NOTICE & ~E_DEPRECATED);
    ini_set('display_errors', '0');
}

date_default_timezone_set(APP_TIMEZONE);
