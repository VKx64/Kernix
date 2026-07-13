<?php
/**
 * Database wrapper around PDO.
 * Uses prepared statements throughout.
 */

class DB
{
    private static ?PDO $pdo = null;

    public static function pdo(): PDO
    {
        if (self::$pdo === null) {
            $dsn = sprintf(
                'mysql:host=%s;port=%d;dbname=%s;charset=%s',
                DB_HOST, DB_PORT, DB_NAME, DB_CHARSET
            );
            try {
                self::$pdo = new PDO($dsn, DB_USER, DB_PASS, [
                    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    PDO::ATTR_EMULATE_PREPARES   => false,
                    PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES " . DB_CHARSET . " COLLATE utf8mb4_unicode_ci",
                ]);
                // Pin the MySQL session timezone to match PHP's APP_TIMEZONE.
                // Without this, NOW() and DEFAULT CURRENT_TIMESTAMP use the
                // server's @@system_time_zone (often EDT on US-hosted cPanel),
                // which produces datetime strings 12h offset from what users
                // in Asia/Manila expect to see.
                //
                // We pass a numeric offset rather than the zone name because
                // MySQL's named-zone lookup requires the mysql.time_zone_name
                // table to be populated (it usually isn't on shared hosting).
                $offset = self::__tz_offset_from_php();
                self::$pdo->exec("SET time_zone = '$offset'");
            } catch (PDOException $e) {
                if (APP_DEBUG) {
                    die('DB connection failed: ' . htmlspecialchars($e->getMessage()));
                }
                die('Database connection failed. Please contact the administrator.');
            }
        }
        return self::$pdo;
    }

    public static function run(string $sql, array $params = []): PDOStatement
    {
        $stmt = self::pdo()->prepare($sql);
        $stmt->execute($params);
        return $stmt;
    }

    public static function row(string $sql, array $params = []): ?array
    {
        $row = self::run($sql, $params)->fetch();
        return $row === false ? null : $row;
    }

    public static function all(string $sql, array $params = []): array
    {
        return self::run($sql, $params)->fetchAll();
    }

    public static function value(string $sql, array $params = [])
    {
        $val = self::run($sql, $params)->fetchColumn();
        return $val === false ? null : $val;
    }

    public static function insert(string $table, array $data): int
    {
        $cols = array_keys($data);
        $placeholders = array_map(fn($c) => ':' . $c, $cols);
        $sql = sprintf(
            'INSERT INTO `%s` (`%s`) VALUES (%s)',
            $table,
            implode('`, `', $cols),
            implode(', ', $placeholders)
        );
        self::run($sql, $data);
        return (int)self::pdo()->lastInsertId();
    }

    public static function update(string $table, array $data, array $where): int
    {
        $setParts = [];
        foreach (array_keys($data) as $col) $setParts[] = "`$col` = :set_$col";
        $whereParts = [];
        foreach (array_keys($where) as $col) $whereParts[] = "`$col` = :where_$col";
        $params = [];
        foreach ($data  as $k => $v) $params["set_$k"]   = $v;
        foreach ($where as $k => $v) $params["where_$k"] = $v;
        $sql = sprintf(
            'UPDATE `%s` SET %s WHERE %s',
            $table,
            implode(', ', $setParts),
            implode(' AND ', $whereParts)
        );
        return self::run($sql, $params)->rowCount();
    }

    public static function softDelete(string $table, int $id): int
    {
        return self::update($table, ['deleted_at' => date('Y-m-d H:i:s')], ['id' => $id]);
    }

    public static function archive(string $table, int $id): int
    {
        return self::update($table, ['archived_at' => date('Y-m-d H:i:s')], ['id' => $id]);
    }

    public static function unarchive(string $table, int $id): int
    {
        return self::update($table, ['archived_at' => null], ['id' => $id]);
    }

    public static function begin(): void    { self::pdo()->beginTransaction(); }
    public static function commit(): void   { self::pdo()->commit(); }
    public static function rollback(): void { if (self::pdo()->inTransaction()) self::pdo()->rollBack(); }

    /**
     * Returns the current PHP timezone as a MySQL-compatible offset string
     * like '+08:00' or '-05:00'. Used to pin the MySQL session TZ at
     * connect time so NOW() and DATETIME defaults match the app's TZ.
     */
    private static function __tz_offset_from_php(): string
    {
        $secs = (new DateTime('now', new DateTimeZone(date_default_timezone_get())))->getOffset();
        $sign = $secs < 0 ? '-' : '+';
        $secs = abs($secs);
        $h = intdiv($secs, 3600);
        $m = intdiv($secs % 3600, 60);
        return sprintf('%s%02d:%02d', $sign, $h, $m);
    }
}
