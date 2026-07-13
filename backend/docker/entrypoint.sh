#!/bin/sh
set -eu

cd /var/www/html
mkdir -p storage/app/public storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs bootstrap/cache
chmod -R ug+rwX storage bootstrap/cache

if [ -z "${APP_KEY:-}" ]; then
    app_key_file="${APP_KEY_FILE:-storage/app/.app-key}"
    mkdir -p "$(dirname "$app_key_file")"

    if [ ! -s "$app_key_file" ]; then
        umask 077
        generated_app_key="$(php artisan key:generate --show --no-ansi)"
        temporary_key_file="${app_key_file}.tmp.$$"
        printf '%s\n' "$generated_app_key" > "$temporary_key_file"
        mv "$temporary_key_file" "$app_key_file"
        unset generated_app_key temporary_key_file
    fi

    APP_KEY="$(tr -d '\r\n' < "$app_key_file")"
    if [ -z "$APP_KEY" ]; then
        echo "The persisted application key is empty." >&2
        exit 1
    fi
    chmod 600 "$app_key_file"
    export APP_KEY
fi

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
    attempt=0
    until php artisan migrate --force; do
        attempt=$((attempt + 1))
        if [ "$attempt" -ge 30 ]; then
            echo "Database was not ready after 30 attempts." >&2
            exit 1
        fi
        sleep 2
    done
fi

if [ "${RUN_SEEDERS:-true}" = "true" ]; then
    php artisan db:seed --force
fi

unset ADMIN_PASSWORD

php artisan storage:link >/dev/null 2>&1 || true
exec "$@"
