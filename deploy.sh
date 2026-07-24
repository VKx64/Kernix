#!/usr/bin/env bash
# Kernix deploy script for il-cs80 (cPanel, no Docker).
#
# Run this from anywhere on the server as the ibmclients user:
#   bash ~/kernix/deploy.sh
#
# It pulls the latest code, reinstalls backend/frontend deps, runs
# migrations, rebuilds caches, and re-syncs the frontend build into
# public_html/ — everything Steps 4-6 of DEPLOYMENT_CPANEL.md did by hand.
# Safe to re-run; every step here is idempotent.

set -euo pipefail

REPO_DIR="$HOME/kernix"
PUBLIC_HTML="$HOME/public_html"
PHP=/usr/local/bin/ea-php84
DOMAIN="https://ibmclients.com"

echo "==> Loading nvm (for Node/npm)"
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null

echo "==> Pulling latest code"
cd "$REPO_DIR"
# chmod (below) and cPanel's Git deploy flow both flip file-mode bits on
# already-tracked files (e.g. .gitignore placeholders). Ignoring mode
# changes keeps `git status` clean so cPanel's "Deploy HEAD Commit" button
# doesn't get blocked by noise that isn't a real content change.
git config core.fileMode false
git pull

echo "==> Installing backend dependencies"
cd "$REPO_DIR/backend"
"$PHP" "$(command -v composer)" install --no-dev --optimize-autoloader --no-interaction --ignore-platform-req=ext-fileinfo

echo "==> Running migrations"
"$PHP" artisan migrate --force

echo "==> Rebuilding caches"
"$PHP" artisan config:cache
"$PHP" artisan route:cache
"$PHP" artisan event:cache
chmod -R 775 storage bootstrap/cache

echo "==> Building frontend"
cd "$REPO_DIR/frontend"
npm ci
VITE_API_ORIGIN="$DOMAIN/backend" npm run build

echo "==> Syncing frontend build into public_html/"
cp -r dist/. "$PUBLIC_HTML/"

echo "==> Re-writing SPA-fallback .htaccess (idempotent, excludes /backend/)"
cat > "$PUBLIC_HTML/.htaccess" << 'EOF'
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_URI} !^/backend/
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
</IfModule>
EOF

echo "==> Smoke test"
curl -sk "$DOMAIN/backend/up" | grep -q "Application up" && echo "Backend OK" || echo "WARNING: backend health check did not return the expected response"

echo "==> Deploy complete"
