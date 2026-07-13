# Kernix Backend

Kernix uses a Laravel API backend for authentication, permissions, projects, tasks, time tracking, messaging, configurable fields, and workspace settings.

## Local setup

The complete application is intended to run from the repository's Docker Compose stack. For backend-only development:

```bash
composer install
cp .env.example .env
# Set a unique ADMIN_PASSWORD of at least 12 characters in .env.
# Adjust DB_HOST and DB_PORT for your local MySQL instance.
php artisan key:generate
php artisan migrate --seed
php artisan serve
```

Run the backend checks with:

```bash
php artisan test
vendor/bin/pint --test
composer validate --strict --no-check-publish
composer audit --locked --no-interaction
```

Configuration is environment-driven. `APP_NAME` and `MAIL_FROM_NAME` default to `Kernix`; SMTP sender values saved through system settings take precedence without being replaced by subsequent database seeding.

Never commit `.env`. A first-time database seed requires `ADMIN_PASSWORD` to contain at least 12 characters; later seeds do not need it and never replace the existing administrator password.

When the Docker container starts without `APP_KEY`, its entrypoint creates `storage/app/.app-key` with private file permissions. The existing backend storage volume preserves that key across container rebuilds. An explicit `APP_KEY` environment value still takes precedence.
