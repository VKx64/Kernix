# Kernix — Laravel + Vite local stack

Kernix is split into five independently containerized services:

- `frontend`: React 19 + TypeScript, built with Vite 8 and served by Nginx
- `backend`: Laravel 13 REST API with Sanctum cookie authentication
- `mysql`: MySQL 8.4, initialized by Laravel migrations and seeders
- `queue`: Laravel's asynchronous worker, including AI estimate reviews
- `scheduler`: Laravel's scheduler for time-based workflow actions

The extracted PHP application is still present as a fallback. It uses a
different Compose project, ports, and volumes, so its database is not reused or
deleted by the new stack.

## Project layout

- `frontend/` contains the standalone React/Vite application and Nginx proxy.
- `backend/` contains the standalone Laravel API, migrations, seeders, and tests.
- `extension/` contains the private Chrome/Edge Manifest V3 time-and-task companion.
- `compose.yaml` connects the frontend, backend, and MySQL containers.
- `legacy/` preserves the original PHP application and runs only through
  `compose.legacy.yaml`.

## Brand and retained technical identifiers

The product name is **Kernix**. Several infrastructure identifiers deliberately
retain their historical values so existing Docker volumes, databases, browser
sessions, and stored user preferences continue to work:

- Current Compose project: `production-management-v2`
- Preserved legacy Compose project: `production-management`
- Local MySQL database/user defaults: `production_v2` and `production_v2_user`
- Compatibility keys in persisted data: `imagic_email` and `imagic_purple`
- Preserved legacy session cookie key: `imagicprod_session`

Do not rename those identifiers as part of a display-branding change. Renaming a
Compose project, volume, database, or persisted key requires a separately
planned data migration. The Docker service names `frontend`, `backend`, and
`mysql` are also stable integration names.

## Prerequisite

Install and start Docker Desktop. No host PHP, Composer, Node.js, or MySQL
installation is required for the default workflow. Copy `.env.example` to
`.env` and set `ADMIN_PASSWORD` to a private value of at least 12 characters.
The ignored `.env` file must never be committed.

## Start everything

From this directory:

```powershell
Copy-Item .env.example .env
# Edit .env and set ADMIN_PASSWORD before the first start.
docker compose up --build -d --wait --wait-timeout 240
```

Open the application at <http://localhost:5173> and sign in with the seed
account:

- Username: `admin`
- Password: the private value you placed in `.env`

Changing `ADMIN_PASSWORD` later does not reset an existing database account;
use **Profile** to change that password.

Local endpoints:

| Service | URL | Purpose |
| --- | --- | --- |
| Frontend | <http://localhost:5173> | Browser application and same-origin API proxy |
| Backend | <http://localhost:8000> | Laravel API; health check at `/up` |
| MySQL | `127.0.0.1:3307` | Optional connection from a local database client |

## Default roles

Fresh local databases create these editable starter roles once. Later permission edits and intentional role deletions are preserved when the seeder runs again.

| Role | Initial scope |
| --- | --- |
| Project Management Role | Full task/project operations, client/contact maintenance, team time, user directory, and analytics; no system administration or user lifecycle changes |
| Employee Role | Dashboard, messages, personal time tracking, task status, comments/time logs, and subtasks |
| Client Role | Dashboard only until membership-based project and client record isolation is enforced |

Do not grant `tasks.view` or `projects.view` to external client accounts yet: those permissions currently expose every workspace record for that resource, not only records belonging to one client.

## Invitation onboarding

Administrators can open **Administration → Users → Invite user**, choose an
email address, role, projects, and an expiry, then copy the generated link to
the recipient. The recipient supplies their own name, username, and password;
the account is created with the selected role and project memberships.

Invitation links are bearer secrets. They expire, can be used only once, and
should be shared privately. Only a one-way token hash is stored by the server.
Project membership records assignments, while resource visibility continues to
follow the existing role permissions. In particular, `projects.view` and
`tasks.view` remain workspace-wide until membership-based isolation is added
across every related API.

## AI project manager

Administrators configure an encrypted OpenRouter API key, an exact model ID,
monthly spend cap, output cap, timeout, and challenge response window under
**Administration → Settings → AI project manager**. AI estimate review is then
enabled separately while editing each project; an eligible human project
manager remains required for oversight.

Each employee request or employee reply results in at most one OpenRouter call.
The AI can challenge, approve (including a smaller counteroffer), or reject.
Provider failures and exhausted budgets leave the request pending for a human.
Managers and administrators can override a completed AI decision with a
required reason, and the append-only decision history records both decisions.

Only task-scoped evidence is sent: task details, estimate and logged time,
subtasks, prior estimate requests for that task, and the current request's
discussion. OpenRouter calls require zero-data-retention routing and do not use
tools, plugins, browsing, attachments, emails, unrelated tasks, or employee
history. Unanswered AI challenges are automatically rejected after the
configured window (48 hours by default).

Ports and local credentials can be changed in `.env`. If `FRONTEND_PORT` is
changed, update both `SANCTUM_STATEFUL_DOMAINS` and `CORS_ALLOWED_ORIGINS` with
the new host and port.

## Common commands

```powershell
# Status and health
docker compose ps -a

# Follow logs for all services
docker compose logs -f

# Follow or rebuild one service
docker compose logs -f backend
docker compose up --build -d backend
docker compose up --build -d frontend

# Run Laravel commands inside the API container
docker compose exec backend php artisan about
docker compose exec backend php artisan migrate:status
docker compose exec backend php artisan test

# Stop containers while preserving the database and uploaded files
docker compose down
```

Starting `backend` also starts MySQL because of its health dependency. Starting
`frontend` brings up the complete dependency chain. The frontend calls relative
`/api`, `/logout`, and `/sanctum` paths plus `POST /login`; Nginx forwards those
requests to Laravel, while `GET /login` remains a refresh-safe React route.
Authentication therefore stays same-origin in the browser.

The local stack intentionally uses Laravel's `log` mail transport and local
file storage. Task email records are kept in the app and outbound mail is
written to backend logs instead of being delivered. Existing attachments are
shown, but this first separated frontend does not yet include a binary upload
control.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for the required checks. Report security
issues privately as described in [SECURITY.md](SECURITY.md).

Kernix is available under the [MIT License](LICENSE).

## Vite hot reload

The default frontend is a reproducible Vite production build served by Nginx.
For frontend development with source mounting and hot reload, use the optional
override:

```powershell
docker compose -f compose.yaml -f compose.dev.yaml up --build -d --wait --wait-timeout 240
docker compose -f compose.yaml -f compose.dev.yaml logs -f frontend
```

Stop that variant with the same file selection:

```powershell
docker compose -f compose.yaml -f compose.dev.yaml down
```

## WhatsApp

Kernix speaks through **one** WhatsApp account — the studio's. That account
messages employees, project managers, and clients, sits in project group chats,
and turns what is said in them into work. Nobody enrols: numbers are matched
against the ones already on personnel records and client contacts.

**Read this first.** The bridge is [Baileys](https://github.com/WhiskeySockets/Baileys),
an unofficial WhatsApp Web client. WhatsApp does not sanction third-party clients
and can permanently ban a number it decides is automated. Link a number the
business can afford to lose, and expect the protocol to change under it. The
sanctioned alternative is Meta's WhatsApp Cloud API, which needs a business
number, Meta verification, and per-conversation fees; swapping to it would touch
only `App\Services\WhatsAppClient`.

### Setting it up

1. Set `WHATSAPP_BRIDGE_TOKEN` in `.env` to a private value, then
   `docker compose up --build -d whatsapp`.
2. Turn **WhatsApp** on for the workspace in **Administration → Workspace**. It is
   the one feature switch that defaults to off.
3. In that screen's **WhatsApp** panel, choose **Show QR** and scan it from the
   phone whose account will speak for the studio (`settings.edit` required).
4. Add the group chats you want it in on the phone, as you would any participant.
   Each chat then appears in the panel's **Chats** list.
5. Point each group at a project — in the panel, or by saying
   `kernix link project 12` in the group itself. Until a chat has a project,
   nothing can be raised from it.

Employees and client contacts are recognised automatically from `phone_1` /
`phone_2` on their records; a number matching nobody is logged and answered with
silence.

### What it does

**In a project group** it stays quiet until addressed. Say `kernix` and then:

| Message | Effect |
| --- | --- |
| `kernix task` | Reads the recent conversation and raises the work in it — one task per thing actually asked for, assigned to whoever was named, otherwise to the project manager. |
| `kernix task only the API bits` | Same, narrowed to what you say. |
| `kernix link project 12` | Tells it which project this group is (`tasks.assign`). |
| `kernix status` / `kernix tasks` | Your own clock and your own task list. |
| `kernix mute` / `unmute` | Stops and resumes everything it sends there. |

Every other message in the group is logged silently and becomes the context the
next `kernix task` reads.

**From a client** nothing is ever a command. What they write is logged as the
project's conversation, and the assistant decides — conservatively — what it is: a
reported defect or a clear request becomes a task on their project, assigned and
acknowledged; a question is passed to the project manager verbatim rather than
answered; thanks and small talk get no reply at all. This applies both in their
own chat and in a project group, since a bug usually arrives as a complaint
dropped into the group everybody shares. An unrecognised number in a group with
no project is ignored entirely.

**One to one with an employee**, their own account's commands, under their own
permissions and the same clock rules as the web client: `in`, `out`, `break`,
`back`, `status`, `tasks`, `start 123`, `stop`, `note 123 text`, `reply text`,
`ask …` (Oliver answers; his actions are never run over WhatsApp). Plain text
answers their newest message thread.

### What it sends, unprompted

| When | Who | What |
| --- | --- | --- |
| Weekdays 08:30 | Project managers | Overdue, unassigned, and anything raised from a chat in the last day, on their own projects (`whatsapp:manager-brief`) |
| Weekdays 09:00 | Employees | What they have overdue and due today (`whatsapp:due-reminders`) |
| Weekdays 17:30 | Employees | Hours short of target, or a clock left running (`whatsapp:daily-nudge`) |
| Mondays 09:30 | Client chats and project groups | What was finished, what is in progress, what the studio is waiting on them for (`whatsapp:client-digest`) |

Plus, as they happen: task messages, and being put on a task. Every command takes
`--dry-run` to see the wording without sending anything. An employee can turn
their own WhatsApp notifications off in the panel; replies and commands keep
working.

### Operating it

The **Chats** list is the control surface: which project a chat feeds, whether it
may be read for work at all, and a mute switch per chat. Every message in either
direction, including refusals, is in `whatsapp_messages` and readable at
`GET /api/whatsapp/messages` with `settings.view`. Tasks raised from a chat carry
a note saying which chat and why, and an audit row. Deleting the `whatsapp_auth`
volume force-unlinks the account. Reading conversations needs **AI task creation**
switched on with an OpenRouter key and model; everything else works without AI.
See `whatsapp/README.md` for the bridge's own configuration.

## Browser companion extension

Build and verify the private Chrome/Edge companion independently of Docker:

```powershell
cd extension
npm ci
npm test
npm run lint
npm run package
```

The versioned private-distribution ZIP is written to `extension/artifacts/`. For local unpacked installation and pairing instructions, see `extension/README.md`. Users generate one-time pairing codes from **Profile → Browser extension** after the backend migration has run.

## Local data and resets

MySQL and Laravel storage use named volumes belonging to the retained
`production-management-v2` project. Migrations and the local seed are safe to
run repeatedly during startup.

To permanently erase **only the new stack's** local data and start from a clean
seed:

```powershell
docker compose down -v
docker compose up --build -d --wait --wait-timeout 240
```

`down -v` is destructive. Keep `COMPOSE_PROJECT_NAME=production-management-v2`
so this command cannot target the preserved legacy volumes by mistake.

## Legacy PHP fallback

The preserved PHP 8.2/Apache app remains under `legacy/` and is available
through `compose.legacy.yaml`. Its historical installation notes are retained
in [`legacy/INSTALL.md`](legacy/INSTALL.md). Always pass its explicit project
name so a new `.env` file cannot redirect the command to the V2 volumes:

Set `LEGACY_ADMIN_PASSWORD` in `.env` to a private value of at least 12
characters before starting this stack. It replaces the historical published
default on untouched legacy databases and does not reset an already changed
password.

```powershell
# Start the legacy app on http://localhost:8080
docker compose -p production-management -f compose.legacy.yaml up --build -d --wait --wait-timeout 180

# Stop it without deleting its database or uploads
docker compose -p production-management -f compose.legacy.yaml down
```

Never add `-v` to the legacy `down` command unless you intentionally want to
delete the legacy database and uploaded-file volumes.

## Deployment note

The supplied defaults are for local development only. Before any deployment,
use a newly generated `APP_KEY`, secret database credentials, HTTPS-secure
cookies, a restricted CORS/Sanctum host list, and production logging/debug
settings.
