<?php
/**
 * Authentication: login, logout, session.
 */

class Auth
{
    public static function attempt(string $username, string $password): ?array
    {
        $user = DB::row(
            "SELECT * FROM users
             WHERE username = :u
               AND status = 'active'
               AND deleted_at IS NULL
               AND archived_at IS NULL
             LIMIT 1",
            ['u' => $username]
        );
        if (!$user) return null;
        if (!password_verify($password, $user['password_hash'])) return null;

        if (password_needs_rehash($user['password_hash'], PASSWORD_DEFAULT)) {
            DB::update('users',
                ['password_hash' => password_hash($password, PASSWORD_DEFAULT)],
                ['id' => $user['id']]);
        }

        self::login($user);
        DB::update('users', [
            'last_login_at' => date('Y-m-d H:i:s'),
            'last_login_ip' => $_SERVER['REMOTE_ADDR'] ?? null,
        ], ['id' => $user['id']]);

        Audit::log('login', 'user', (int)$user['id'], 'User logged in');
        return $user;
    }

    public static function login(array $user): void
    {
        session_boot();
        session_regenerate_id(true);
        $_SESSION['uid']      = (int)$user['id'];
        $_SESSION['username'] = $user['username'];
        $_SESSION['role_id']  = (int)$user['role_id'];
        $_SESSION['login_at'] = time();
    }

    public static function logout(): void
    {
        session_boot();
        $uid = self::id();
        if ($uid) Audit::log('logout', 'user', $uid, 'User logged out');
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000,
                $params['path'], $params['domain'], $params['secure'], $params['httponly']);
        }
        session_destroy();
    }

    public static function check(): bool
    {
        session_boot();
        return !empty($_SESSION['uid']);
    }

    public static function id(): ?int
    {
        session_boot();
        return $_SESSION['uid'] ?? null;
    }

    public static function user(): ?array
    {
        if (!self::check()) return null;
        static $cache = null;
        if ($cache !== null && $cache['id'] == self::id()) return $cache;
        $cache = DB::row('SELECT * FROM users WHERE id = :id', ['id' => self::id()]);
        return $cache;
    }

    public static function require_login(): void
    {
        if (!self::check()) {
            $back = $_SERVER['REQUEST_URI'] ?? '/';
            redirect(url('login', ['back' => $back]));
        }
    }

    public static function hash(string $password): string
    {
        return password_hash($password, PASSWORD_DEFAULT);
    }
}
