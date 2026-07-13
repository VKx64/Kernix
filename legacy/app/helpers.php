<?php
/**
 * General helpers.
 */

// ----- Output escaping -----
function e($value): string
{
    return htmlspecialchars((string)$value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

// ----- HTTPS detection that works behind cPanel / reverse proxies -----
function is_https(): bool
{
    if (!empty($_SERVER['HTTPS']) && strtolower($_SERVER['HTTPS']) !== 'off') return true;
    if (!empty($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') return true;
    if (!empty($_SERVER['HTTP_X_FORWARDED_SSL']) && $_SERVER['HTTP_X_FORWARDED_SSL'] === 'on') return true;
    if (!empty($_SERVER['SERVER_PORT']) && (int)$_SERVER['SERVER_PORT'] === 443) return true;
    return false;
}

// ----- Session bootstrap -----
function session_boot(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;
    session_name(SESSION_NAME);
    session_set_cookie_params([
        'lifetime' => SESSION_LIFETIME,
        'path'     => APP_BASE ?: '/',
        'domain'   => '',
        'secure'   => is_https(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

// ----- CSRF -----
function csrf_token(): string
{
    session_boot();
    if (empty($_SESSION[CSRF_TOKEN_KEY])) {
        $_SESSION[CSRF_TOKEN_KEY] = bin2hex(random_bytes(32));
    }
    return $_SESSION[CSRF_TOKEN_KEY];
}

function csrf_field(): string
{
    return '<input type="hidden" name="' . CSRF_TOKEN_KEY . '" value="' . e(csrf_token()) . '">';
}

function csrf_check(): void
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') return;
    session_boot();
    $sent = $_POST[CSRF_TOKEN_KEY] ?? '';
    $expected = $_SESSION[CSRF_TOKEN_KEY] ?? '';
    if (!is_string($sent) || $sent === '' || $expected === '' || !hash_equals($expected, $sent)) {
        http_response_code(419);
        die('Security token mismatch. Please reload the page and try again.');
    }
}

// ----- Redirect / URL helpers -----
function redirect(string $url): void
{
    header('Location: ' . $url);
    exit;
}

function url(string $page, array $params = []): string
{
    $params = array_merge(['p' => $page], $params);
    return APP_BASE . '/index.php?' . http_build_query($params);
}

function asset(string $path): string
{
    return ASSETS_URL . '/' . ltrim($path, '/');
}

// ----- Flash messages -----
function flash_set(string $type, string $msg): void
{
    session_boot();
    $_SESSION['_flash'][] = ['type' => $type, 'msg' => $msg];
}

function flash_pull(): array
{
    session_boot();
    $f = $_SESSION['_flash'] ?? [];
    unset($_SESSION['_flash']);
    return $f;
}

// ----- Input helpers -----
function input(string $key, $default = null)
{
    return $_POST[$key] ?? $_GET[$key] ?? $default;
}

function input_int(string $key, int $default = 0): int
{
    return (int)($_POST[$key] ?? $_GET[$key] ?? $default);
}

// ----- Formatting -----
function fmt_date(?string $datetime, string $format = 'M j, Y'): string
{
    if (!$datetime) return '';
    try { return (new DateTime($datetime))->format($format); }
    catch (Exception $e) { return ''; }
}

function fmt_datetime(?string $datetime, string $format = 'M j, Y g:i A'): string
{
    return fmt_date($datetime, $format);
}

function fmt_bytes(?int $bytes): string
{
    if (!$bytes) return '0 B';
    $units = ['B','KB','MB','GB','TB'];
    $i = (int)floor(log($bytes, 1024));
    return round($bytes / (1024 ** $i), 1) . ' ' . $units[$i];
}

function initials(string $first, string $last): string
{
    return strtoupper((substr($first, 0, 1) ?: '') . (substr($last, 0, 1) ?: ''));
}

// ----- Settings cache -----
/** @internal */
function _settings_cache(?array $set = null): array
{
    static $cache = null;
    if ($set !== null) { $cache = $set; return $cache; }
    if ($cache === null) {
        try {
            $row = DB::row('SELECT * FROM system_settings WHERE id = 1');
            $cache = $row ?: [];
        } catch (Throwable $e) {
            $cache = [];
        }
    }
    return $cache;
}

function settings(): array
{
    return _settings_cache();
}

/**
 * Force the settings cache to reload on next read. Call after writing to
 * system_settings inside the same request so subsequent code sees fresh values.
 */
function settings_bust_cache(): void
{
    try {
        $row = DB::row('SELECT * FROM system_settings WHERE id = 1');
        _settings_cache($row ?: []);
    } catch (Throwable $e) {
        _settings_cache([]);
    }
}

/**
 * Single-client-mode helpers.
 *
 * When the toggle is ON, the app behaves as if it serves exactly one client.
 * - Client UI is hidden everywhere (sidebar, dashboard cards, list columns,
 *   modal pickers, etc.)
 * - New projects and contacts auto-attach to the designated client
 * - The Clients page redirects to the dashboard with a flash message
 * - The client is edited inline from Settings → System
 */
function is_single_client_mode(): bool
{
    $s = settings();
    return !empty($s['single_client_mode']) && !empty($s['single_client_id']);
}

function single_client_id(): ?int
{
    $s = settings();
    if (empty($s['single_client_mode'])) return null;
    $id = (int)($s['single_client_id'] ?? 0);
    return $id > 0 ? $id : null;
}

function single_client(): ?array
{
    $id = single_client_id();
    if (!$id) return null;
    static $cache = [];
    if (!array_key_exists($id, $cache)) {
        try {
            $cache[$id] = DB::row('SELECT * FROM clients WHERE id = :id AND deleted_at IS NULL', ['id' => $id]) ?: null;
        } catch (Throwable $e) {
            $cache[$id] = null;
        }
    }
    return $cache[$id];
}

// ----- Field values lookup -----
function field_values(string $fieldKey, bool $activeOnly = true): array
{
    $sql = "SELECT fv.* FROM field_values fv
            JOIN fields f ON f.id = fv.field_id
            WHERE f.key_name = :k AND fv.deleted_at IS NULL";
    if ($activeOnly) $sql .= " AND fv.status = 'active'";
    $sql .= " ORDER BY fv.sort_order, fv.label";
    return DB::all($sql, ['k' => $fieldKey]);
}

function field_value_label(?int $id): string
{
    if (!$id) return '';
    $row = DB::row('SELECT label FROM field_values WHERE id = :id', ['id' => $id]);
    return $row ? $row['label'] : '';
}

// ----- View rendering -----
function render(string $view, array $viewVars = [], string $layout = 'layout'): void
{
    // Extract render args into local vars for the view. The parameter is
    // named $viewVars (not $data) so callers can safely pass a key called
    // 'data' — otherwise EXTR_SKIP would silently refuse to overwrite the
    // parameter and the view would receive the wrong $data.
    extract($viewVars, EXTR_SKIP);
    ob_start();
    require VIEWS_PATH . '/' . $view . '.php';
    $content = ob_get_clean();
    if ($layout) {
        require VIEWS_PATH . '/' . $layout . '.php';
    } else {
        echo $content;
    }
}

// ----- JSON response -----
function json_response($data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($data);
    exit;
}