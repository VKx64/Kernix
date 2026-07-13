#!/bin/sh
set -eu

if [ "${1:-}" = "apache2-foreground" ]; then
    if [ -z "${LEGACY_ADMIN_PASSWORD:-}" ] || [ "${#LEGACY_ADMIN_PASSWORD}" -lt 12 ]; then
        echo >&2 "LEGACY_ADMIN_PASSWORD must contain at least 12 characters."
        exit 1
    fi

    php <<'PHP'
<?php

$pdo = new PDO(
    sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', getenv('DB_HOST'), getenv('DB_PORT'), getenv('DB_NAME')),
    getenv('DB_USER'),
    getenv('DB_PASSWORD'),
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION],
);

$publishedDefaultHash = '$2y$10$l7t9pjNAEBqv6kINbcycyu9p9eI16mkQQ9JPI5/6ZkiJd0kr2/S.6';
$pdo->beginTransaction();
$statement = $pdo->query('SELECT password_hash FROM users WHERE id = 1 FOR UPDATE');
$currentHash = $statement->fetchColumn();

if (is_string($currentHash) && hash_equals($publishedDefaultHash, $currentHash)) {
    $update = $pdo->prepare('UPDATE users SET password_hash = :password_hash WHERE id = 1');
    $update->execute(['password_hash' => password_hash((string) getenv('LEGACY_ADMIN_PASSWORD'), PASSWORD_DEFAULT)]);
}

$pdo->commit();
PHP
fi

exec docker-php-entrypoint "$@"
