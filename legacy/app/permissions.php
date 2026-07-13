<?php
/**
 * Role-based permission checks.
 */

class Perm
{
    private static ?array $cache = null;

    private static function load(): array
    {
        if (self::$cache !== null) return self::$cache;
        $uid = Auth::id();
        if (!$uid) return self::$cache = [];
        $rows = DB::all(
            "SELECT rp.permission_key FROM role_permissions rp
             JOIN users u ON u.role_id = rp.role_id
             WHERE u.id = :uid",
            ['uid' => $uid]
        );
        self::$cache = array_column($rows, 'permission_key');
        return self::$cache;
    }

    public static function can(string $key): bool
    {
        return in_array($key, self::load(), true);
    }

    public static function canAny(array $keys): bool
    {
        foreach ($keys as $k) if (self::can($k)) return true;
        return false;
    }

    public static function require(string $key): void
    {
        Auth::require_login();
        if (!self::can($key)) {
            http_response_code(403);
            require VIEWS_PATH . '/403.php';
            exit;
        }
    }

    public static function flush(): void { self::$cache = null; }

    public static function role(): ?string
    {
        $uid = Auth::id();
        if (!$uid) return null;
        return DB::value(
            "SELECT r.key_name FROM roles r JOIN users u ON u.role_id = r.id WHERE u.id = :uid",
            ['uid' => $uid]
        );
    }

    public static function isAdmin(): bool { return self::role() === 'admin'; }
}
