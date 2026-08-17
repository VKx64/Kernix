# Deploying Kernix to cPanel (il-cs80) without Docker

Stack: Laravel 13 / PHP `^8.4` backend, React 19 + Vite static frontend, MariaDB.
You have SSH access as your cPanel user (non-root) on `il-cs80`. Subdomains
aren't available on this plan, so everything is served from the one domain,
`ibmclients.com`, using a subfolder for the API and a symlink trick to keep
it same-origin with the frontend (this also sidesteps CORS entirely — no
separate origin means no CORS/cross-site-cookie config needed at all).

Verified directly in the `ibmclients` cPanel account (read-only checks,
nothing was changed):

- **PHP 8.4 (`ea-php84`) is available** in MultiPHP Manager, alongside
  7.2–8.3. System default is currently 8.2. Binary path convention on this
  host: `/usr/local/bin/ea-php84`.
- **Home directory**: `/home/ibmclients`. Only domain is `ibmclients.com`
  (doc root `/public_html`).
- **Database provisioned**: `ibmclients_production` (empty) with user
  `ibmclients_master` already granted full privileges on it.
- **Cron Jobs** is empty and ready.
- **Git™ Version Control** is enabled in cPanel and unused.
- Code is pushed to `https://github.com/VKx64/Kernix.git` (`main`, commit
  `6d43fd0`) — ready to pull from the server.

Because there's no root/supervisor, the two processes that normally run as
long-lived containers (`queue`, `scheduler` in `compose.yaml`) have to be
replaced with cron jobs instead.

---

## 0. Layout

```
/home/ibmclients/
├── kernix/                      ← git checkout (outside public_html)
│   ├── backend/
│   │   ├── public/              ← real Laravel public dir
│   │   └── ...
│   └── frontend/
└── public_html/                 ← ibmclients.com document root
    ├── index.html, assets/...   ← built frontend (uploaded, not the repo)
    ├── .htaccess                ← SPA fallback + excludes /backend
    └── backend/  → symlink → ../kernix/backend/public
```

- Frontend calls the API at `https://ibmclients.com/backend/...`
- Laravel's `routes/web.php` (`/login`, `/logout`) and `routes/api.php`
  (auto-prefixed `/api/...` by Laravel) both live under that same
  `/backend` mount, so the frontend just needs `VITE_API_ORIGIN` set to
  `https://ibmclients.com/backend`.
- Keeping the actual app code (`app/`, `.env`, `vendor/`, migrations) in
  `~/kernix/` outside `public_html/` and only symlinking `public/` in is
  what keeps them non-web-accessible without extra `.htaccess` deny rules.

---

## 1. PHP 8.4

Already confirmed available — no support ticket needed. Since there's no
subdomain to attach a PHP version to, this account's PHP version is set at
**MultiPHP Manager** against `ibmclients.com` itself (the whole account gets
one PHP version on non-subdomain shared hosting). Set it to `8.4` there, and
enable these extensions in **MultiPHP INI Editor**:

```
bcmath, intl, mbstring, opcache, pdo_mysql, curl, fileinfo, tokenizer, xml
```

(These are the ones the Docker image installs explicitly; the rest ship
with cPanel's PHP builds by default.) Since the frontend is plain static
HTML/JS, it doesn't care what PHP version serves it — 8.4 site-wide is fine.

Task attachments accept files up to 25 MB each, so raise these in the same
**MultiPHP INI Editor** or the API will reject large uploads before Laravel
ever sees them:

```
upload_max_filesize = 25M
post_max_size = 128M      # 25M x the 10-file batch limit, plus overhead
max_file_uploads = 20
```

Public project-form submissions accept up to 3 files of 10 MB each (30 MB
per request), so they need `upload_max_filesize >= 12M` and
`post_max_size >= 40M` at minimum — both already covered by the values
above. Below those, a 10 MB upload arrives at Laravel as an empty POST
before validation ever runs, so a public visitor sees a bare 422 with no
files, not a helpful error.

The `public-form-submit` rate limiter (keyed `slug|ip` in
`AppServiceProvider`) and the `ip_hash` stored on each submission both trust
`$request->ip()`. That's correct today because this deployment sits direct on
the server with no reverse proxy or CDN in front. If one is ever added,
`trustProxies` MUST be configured with that proxy's actual CIDR ranges before
the public form is exposed again — never `trustProxies(at: '*')`, which makes
`X-Forwarded-For` attacker-controlled and makes both the rate limiter and the
stored `ip_hash` worthless.

---

## 2. Database

Already provisioned — `ibmclients_production` (empty) + user
`ibmclients_master`, password already set (see your `.env` values below).

MariaDB 10.11 (already running on the server) is fully compatible with the
app's `mysql` driver — no changes needed there.

---

## 3. Get the code onto the server

**Option A — cPanel Git™ Version Control (recommended)**: In cPanel:
**Git Version Control → Create**, Clone URL
`https://github.com/VKx64/Kernix.git`, repository path `kernix` (relative to
home, i.e. `/home/ibmclients/kernix`). cPanel clones it for you. Future
deploys are "Manage → Pull or Deploy" from the same UI instead of SSH
`git pull`.

**Option B — manual SSH clone**:

```bash
cd ~
git clone https://github.com/VKx64/Kernix.git kernix
```

---

## 4. Backend: install & configure

```bash
cd ~/kernix/backend

# Composer — check whether it's already on PATH for ea-php84 first:
composer --version || php -d extension=curl /usr/local/bin/ea-php84 $(which composer)
# If neither works, cPanel's Terminal (Advanced -> Terminal) or a support
# ticket will confirm the exact Composer path for this account.

composer install --no-dev --optimize-autoloader --no-interaction

cp .env.example .env
```

Edit `.env` (via `nano .env` or File Manager) with production values:

```dotenv
APP_NAME="Kernix"
APP_ENV=production
APP_DEBUG=false
APP_URL=https://ibmclients.com/backend
APP_TIMEZONE=Asia/Manila
FRONTEND_URL=https://ibmclients.com

DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=ibmclients_production
DB_USERNAME=ibmclients_master
DB_PASSWORD=":t]ZKkr-pj*g!Yg@%"

SESSION_DRIVER=database
SESSION_LIFETIME=480
SESSION_DOMAIN=null
SESSION_SECURE_COOKIE=true
SESSION_SAME_SITE=lax

SANCTUM_STATEFUL_DOMAINS=ibmclients.com
CORS_ALLOWED_ORIGINS=https://ibmclients.com

CACHE_STORE=database
QUEUE_CONNECTION=database
FILESYSTEM_DISK=local
MAIL_MAILER=log

ADMIN_USERNAME=admin
ADMIN_PASSWORD=<set a strong one — 12+ chars, required by DatabaseSeeder>
```

> The DB password contains `$`, `!`, `%` — since it's already quoted with
> `"..."` in `.env`, Laravel's dotenv parser handles it literally as-is; no
> extra escaping needed. If you edit it by hand later, keep the quotes.

> Because everything is same-origin now (`ibmclients.com` serves both the
> SPA and, via `/backend`, the API), `SESSION_DOMAIN=null` and
> `SESSION_SAME_SITE=lax` are all you need — no cross-subdomain cookie
> config to worry about.

Then finish setup:

```bash
php artisan key:generate
php artisan migrate --force
php artisan db:seed --force        # creates the admin user etc.
php artisan storage:link
php artisan config:cache
php artisan route:cache
php artisan event:cache
```

Set writable permissions:

```bash
chmod -R 775 storage bootstrap/cache
```

Task attachments live in `storage/app/private/task-attachments/`, outside the
document root — they are streamed by the API after a permission check, never
served directly. That directory must survive a redeploy, so keep it out of any
"wipe and re-upload" step (see §10).

---

## 5. Wire up the `/backend` mount

Symlink Laravel's `public/` folder into the site's document root:

```bash
ln -s /home/ibmclients/kernix/backend/public /home/ibmclients/public_html/backend
```

Laravel's own `backend/public/.htaccess` (already in the repo) rewrites
requests to `index.php` within that directory — but because it's reached via
a symlink from a subfolder rather than being the site root, add an explicit
`RewriteBase` so mod_rewrite doesn't get confused about where it is. Edit
`~/kernix/backend/public/.htaccess` and add `RewriteBase /backend/` as the
first line inside the `<IfModule mod_rewrite.c>` block (right after
`RewriteEngine On`).

If cPanel's Apache config has `AllowOverride All` for this account (standard
on cPanel), the `.htaccess` just works with no extra vhost changes. If
`/backend/login` or `/backend/api/...` 404s after deployment, that's the
first thing to check — some shared configs need `Options +FollowSymLinks`
added alongside the `RewriteBase` line.

---

## 6. Frontend: build locally, upload static files

Node `>=22.12` is required by `package.json`, which cPanel's shared PHP
environment won't have. **Build on your own machine**, not the server:

```bash
cd frontend
npm ci
VITE_API_ORIGIN=https://ibmclients.com/backend npm run build
```

This produces `frontend/dist/`. Upload its **contents** (not the folder
itself) directly into `public_html/` (via File Manager upload+extract, or
`scp -r dist/* user@il-cs80:~/public_html/`). This will sit alongside the
`backend` symlink from Step 5 — don't let the upload overwrite or delete it.

Since this is a React Router SPA, add `public_html/.htaccess` so deep links
(e.g. `/tasks/42`) don't 404 on refresh, **while excluding `/backend` so API
requests aren't swallowed by the SPA fallback**:

```apache
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_URI} !^/backend/
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
</IfModule>
```

That `!^/backend/` condition is the important part — without it, every
`/backend/api/...` request would get rewritten to `/index.html` before Apache
even reaches Laravel's own `.htaccess` in the symlinked directory.

`frontend/src/lib/api.ts` reads `VITE_API_ORIGIN` via `import.meta.env`, so
passing it as a build-time env var to `npm run build` (as above) is enough
to point the built SPA at `/backend`.

---

## 7. Replace the `queue` and `scheduler` containers with cron

In cPanel: **Cron Jobs**. Add two entries:

**Scheduler** — runs Laravel's scheduler every minute, which is what fires
the `everyFifteenMinutes()` job already defined in
`backend/routes/console.php`:

```
* * * * * cd /home/ibmclients/kernix/backend && php artisan schedule:run >> /dev/null 2>&1
```

**Queue worker** — since there's no supervisor to keep `queue:work` running
forever, run it in short bursts via cron with `--stop-when-empty` so it
exits cleanly each time instead of piling up overlapping processes:

```
* * * * * cd /home/ibmclients/kernix/backend && php artisan queue:work --stop-when-empty --tries=1 --timeout=90 --sleep=2 >> /dev/null 2>&1
```

This gives close-to-realtime job processing (worst case ~1 min latency)
without a persistent daemon. If AI task generation / project memory jobs
need faster turnaround, this is the thing to revisit later (e.g. asking
AspirationHosting whether a persistent SSH process via `screen`/`tmux` +
`nohup` is tolerated on your plan).

---

## 8. SSL

**SSL/TLS Status** in cPanel → run AutoSSL for `ibmclients.com` (usually
already on by default via Let's Encrypt/Sectigo on cPanel — the account
overview already showed an active SSL certificate). Confirm it resolves
over `https://` before testing login, since `SESSION_SECURE_COOKIE=true`
above will silently drop cookies over plain HTTP.

---

## 9. Smoke test

- `https://ibmclients.com/backend/up` → should return Laravel's health check OK
- `https://ibmclients.com` → loads the SPA
- Log in with the `ADMIN_USERNAME`/`ADMIN_PASSWORD` you seeded
- Create a task, confirm it round-trips through the API
- Trigger something that enqueues a job (e.g. AI task generation) and
  confirm it completes within ~1 minute (validates the cron queue worker)

---

## 10. Redeploying updates later

```bash
cd ~/kernix
git pull            # or use cPanel's Git UI "Pull or Deploy"
cd backend
composer install --no-dev --optimize-autoloader --no-interaction
php artisan migrate --force
php artisan config:cache && php artisan route:cache && php artisan event:cache
```

For frontend changes: rebuild locally and re-upload `dist/` contents into
`public_html/`, overwriting the old ones (leave the `backend` symlink alone).

---

## 11. MCP server (`mcp.ibmclients.com`)

This is what lets Claude and ChatGPT work inside Kernix. It is a long-running
Node process rather than PHP, and this account has no supervisor for such a
thing — cPanel's **Setup Node.js App** (Passenger) is not on the plan, and
there is no user systemd. So the pieces already on the box do the job:

- **Node 22** via nvm, which is already here for the frontend build.
- **cron** restarts the server within a minute of any stop — the same shape
  already used for the queue worker, for the same reason.
- **Apache** proxies `mcp.ibmclients.com` to the local port via `.htaccess`.
  Verified working on this host: `mod_proxy` accepts `[P]` from `.htaccess`,
  and the subdomain already carries a valid Let's Encrypt certificate.

The server never touches the database. It calls the same public API the web
client does, with each caller's own token, so it needs no credentials of its
own and no access beyond HTTPS.

All of this is optional. Kernix works fully without it.

### 11.1 Point the subdomain at the app

The subdomain exists already. Two things to set:

1. **Domains → `mcp.ibmclients.com` → enable Force HTTPS Redirect.** Tokens
   travel in an `Authorization` header on every call, and ChatGPT refuses
   plain-HTTP connectors outright.
2. Put this in `~/public_html/mcp.ibmclients.com/.htaccess`, **above** the
   cPanel-generated PHP block (append is fine; leave the PHP directives alone):

```apache
# Everything on this subdomain is the MCP server, which listens on a local
# port. Nothing is served from this folder.
RewriteEngine On
RewriteCond %{HTTPS} off
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [R=301,L]
RewriteRule ^(.*)$ http://127.0.0.1:31380/$1 [P,L]
```

Keep the port here and in `.env.production` the same.

### 11.2 Configure the server

```bash
cd ~/kernix/mcp
cp .env.production.example .env.production
```

Defaults in that file are correct for this account. Do **not** add
`KERNIX_API_TOKEN`: in hosted mode each caller presents their own, and a token
here would hand every caller that one account.

### 11.3 Tell Kernix where it lives

In `~/kernix/backend/.env`:

```
MCP_PUBLIC_URL=https://mcp.ibmclients.com/mcp
```

Then re-run `deploy.sh` (or `php artisan config:cache`). Without it the
settings screen prints a localhost address nobody can connect to.

### 11.4 Keep it running

```bash
chmod +x ~/kernix/mcp/keepalive.sh
```

Then in **cPanel → Cron Jobs**, add a third entry beside the two Laravel ones:

```
* * * * * /home/ibmclients/kernix/mcp/keepalive.sh >> /dev/null 2>&1
```

It exits immediately when the server is already answering, so the cost of
running every minute is negligible. Its log is `~/logs/kernix-mcp.log`.

`deploy.sh` stops the old process after each build and lets this cron start
the new one, so there is only ever one supervisor.

### 11.5 Check it

```bash
curl https://mcp.ibmclients.com/healthz     # {"ok":true,...}
curl -X POST https://mcp.ibmclients.com/mcp # 401 — correct without a token
```

A 401 from `/mcp` is the right answer, not a fault. `/healthz` is what to point
uptime monitoring at.

Then in Kernix: **Settings → Workspace → AI assistant access** → create a
connection and paste the config it prints into Claude or ChatGPT.

### 11.6 Known limits of this arrangement

- **Up to a minute of downtime per crash.** cron is the supervisor, so a dead
  process is not noticed until the next run. Acceptable for an assistant;
  worth knowing before someone reports it as flaky.
- **A reboot is covered**, since cron restarts regardless of why it stopped.
- **No zero-downtime deploys.** The old process stops at build time and the new
  one starts on the next minute.

If Setup Node.js App is ever enabled on this plan, Passenger removes all three
limits and the `.htaccess` proxy and cron entry can go.

### 11.7 If it will not start

- **Check `~/logs/kernix-mcp.log`** first — a missing `KERNIX_BASE_URL` exits
  at boot with the reason, rather than failing on the first call.
- **502 or 503 from the subdomain** — the server is not listening. Run
  `~/kernix/mcp/keepalive.sh` by hand and read the log.
- **Every request answers 401** — the proxy is stripping `Authorization`. That
  header carries the whole credential and has to arrive intact.
- **The public URL returns the cPanel default page** — the `.htaccess` rule is
  not being applied; confirm it sits in the subdomain's own document root.

---

## Open questions to resolve with AspirationHosting support if you hit walls

- Confirm the exact Composer binary/path for `ea-php84` on this account
  (SSH `composer --version` first — many cPanel installs already have it on
  PATH; if not, Terminal or a quick support ticket will confirm it).
- Ask whether long-running SSH processes (`nohup`/`screen`) are permitted,
  in case the cron-based queue worker's ~1 min latency isn't good enough.
- Whether **Setup Node.js App** (Passenger) can be enabled on this plan. It is
  not present today, so section 11 supervises the MCP server with cron instead.
  Passenger would remove the up-to-a-minute restart gap and allow zero-downtime
  deploys, but nothing is blocked without it.
- If `/backend/...` 404s after Step 5, confirm `AllowOverride All` and
  `Options +FollowSymLinks` are in effect for this account's vhost.
