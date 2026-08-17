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

# The MCP server, which lets Claude and ChatGPT work inside Kernix. It is a
# long-running Node process rather than PHP, so Apache cannot serve it.
#
# This account has no "Setup Node.js App" in cPanel, so cron supervises it
# instead: mcp/keepalive.sh restarts it within a minute of any stop, and an
# .htaccess proxy on mcp.ibmclients.com puts it on the public internet. See
# DEPLOYMENT_CPANEL.md section 11. Every step below is non-fatal — a deploy
# must never break over the assistant integration.
MCP_DIR="$REPO_DIR/mcp"
MCP_DOMAIN="https://mcp.ibmclients.com"

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

echo "==> Building the MCP server"
if [ -d "$MCP_DIR" ]; then
  cd "$MCP_DIR"
  npm ci
  npm run build
  # Drop the build-only dependencies again; Passenger only needs what runs.
  npm prune --omit=dev

  chmod +x "$MCP_DIR/keepalive.sh" 2>/dev/null || true

  # Stop the old build; the keepalive cron starts the new one within a minute.
  # Killing rather than restarting here keeps one supervisor rather than two.
  if [ -f "$MCP_DIR/.env.production" ]; then
    pkill -f "$MCP_DIR/dist/index.js" 2>/dev/null || true
    echo "    Old process stopped; keepalive cron will start the new build"
  else
    echo "    NOTE: $MCP_DIR/.env.production is missing, so the server will not start."
    echo "          Copy .env.production.example to it — DEPLOYMENT_CPANEL.md section 11."
  fi
else
  echo "    NOTE: $MCP_DIR not found, skipping"
fi

echo "==> Smoke test"
curl -sk "$DOMAIN/backend/up" | grep -q "Application up" && echo "Backend OK" || echo "WARNING: backend health check did not return the expected response"

# A 401 from /mcp is the correct answer to an unauthenticated request, so the
# health endpoint is what gets checked. Non-fatal: the rest of Kernix works
# whether or not the assistant integration is up.
if curl -sk --max-time 10 "$MCP_DOMAIN/healthz" | grep -q '"ok":true'; then
  echo "MCP OK"
else
  echo "NOTE: no MCP server answering at $MCP_DOMAIN/healthz (expected until it is hosted)"
fi

echo "==> Deploy complete"
