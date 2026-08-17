#!/usr/bin/env bash
# Keeps the Kernix MCP server running on shared hosting.
#
# This account has no process supervisor — cPanel's "Setup Node.js App"
# (Passenger) is not on the plan, and there is no user systemd. So cron plays
# the part: this script runs every minute, does nothing when the server is
# already answering, and starts it when it is not. Whatever kills the process —
# a reap, a crash, a server reboot — it is back inside a minute.
#
# The same shape the queue worker already uses, for the same reason.
#
# Install (once):
#   chmod +x ~/kernix/mcp/keepalive.sh
#   crontab -e   →   * * * * * /home/ibmclients/kernix/mcp/keepalive.sh >> /dev/null 2>&1
#
# Configuration lives in mcp/.env.production, which is not in git because it
# names the site and is environment-specific. See DEPLOYMENT_CPANEL.md §11.
set -uo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$HOME/logs"
LOG="$LOG_DIR/kernix-mcp.log"
mkdir -p "$LOG_DIR"

# Cron runs with a bare environment, so nvm has to be loaded by hand.
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null 2>&1 || true

if [ -f "$APP_DIR/.env.production" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$APP_DIR/.env.production"
  set +a
fi

PORT_TO_CHECK="${KERNIX_MCP_PORT:-8765}"

# Already serving? Then there is nothing to do, and this is the common case —
# it runs 1,440 times a day and should cost almost nothing.
if curl -sf --max-time 5 "http://127.0.0.1:${PORT_TO_CHECK}/healthz" >/dev/null 2>&1; then
  exit 0
fi

if [ ! -f "$APP_DIR/dist/index.js" ]; then
  echo "$(date -Is) not started: dist/index.js is missing, run deploy.sh first" >> "$LOG"
  exit 0
fi

# A process that is running but not answering is worse than none: it holds the
# port and every request hangs. Clear it before starting a replacement.
pkill -f "$APP_DIR/dist/index.js" 2>/dev/null || true
sleep 1

echo "$(date -Is) starting MCP server on port ${PORT_TO_CHECK}" >> "$LOG"
nohup node "$APP_DIR/dist/index.js" >> "$LOG" 2>&1 &
