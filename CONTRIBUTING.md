# Contributing to Kernix

## Local setup

Copy `.env.example` to `.env`, set a private `ADMIN_PASSWORD` of at least 12
characters, choose non-production local database credentials, and run:

```powershell
docker compose up -d --build
```

The application is available at `http://localhost:5173`.

## Required checks

Before opening a pull request, run:

```powershell
docker compose exec -T backend composer validate --strict --no-check-publish
docker compose exec -T backend composer audit --locked --no-interaction
docker compose exec -T backend vendor/bin/pint --test
docker compose exec -T backend php artisan test

npm --prefix frontend ci
npm --prefix frontend run check
npm --prefix frontend audit --audit-level=high

npm --prefix extension ci
npm --prefix extension run check
npm --prefix extension audit --audit-level=high

docker compose config --quiet
```

Keep pull requests focused. Describe permission, migration, API, or compatibility
effects explicitly, and never commit `.env` files, credentials, runtime uploads,
dependency directories, or generated build output.
