# Kernix MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) server that gives an AI assistant —
Claude, ChatGPT, or anything else that speaks MCP — the tools to work as a project manager inside
Kernix: read the portfolio, chase what is late, triage client intake, decide approvals, and change
tasks.

It talks to the same public API the web client uses. It adds no backend code, no new database
tables and no new permissions: whatever the token's account may do, the assistant may do, and
nothing more.

## What it exposes

Seventeen read tools, and fourteen more when writing is enabled.

**Orientation** — `kernix_whoami`, `kernix_vocabulary`, `kernix_dashboard`

**The questions a project manager actually asks** — `kernix_whats_late` (everything overdue or
blocked, worst first), `kernix_workload` (who is carrying what, so you can see who is buried
before assigning more), `kernix_pending_approvals` (every estimate and work request waiting on a
decision)

**Portfolio** — `kernix_list_clients`, `kernix_list_projects`, `kernix_get_project`,
`kernix_list_people`

**Tasks** — `kernix_list_tasks`, `kernix_get_task`

**Operations** — `kernix_list_submissions`, `kernix_timesheet`, `kernix_who_is_working`,
`kernix_list_messages`, `kernix_clock_state`

**Writes** (only when `KERNIX_ALLOW_WRITES=1`) — `kernix_create_task`, `kernix_update_task`,
`kernix_comment_on_task`, `kernix_add_subtask`, `kernix_create_project`, `kernix_update_project`,
`kernix_decide_estimate_request`, `kernix_decide_work_request`, `kernix_convert_submission`,
`kernix_decline_submission`, `kernix_send_message`, `kernix_reply_message`, `kernix_clock_in`,
`kernix_clock_out`

Two design choices are worth knowing about.

**Names, not ids.** Kernix stores status, urgency and type as workspace-configurable rows, so its
API speaks in integers (`status_value_id: 27`). Every tool here takes the name instead —
`status: "quality_check"` — and resolves it per workspace. An invalid name comes back with the
valid options listed, which an assistant can act on.

**Lines, not JSON.** A task record carries 28 fields, six of which matter to a project manager.
Results render one entity per line with the id first, so a fifty-task answer costs a few hundred
tokens rather than several thousand.

## Setup

The server runs as a compose service alongside the rest of Kernix:

```bash
docker compose up -d mcp
curl http://127.0.0.1:8765/healthz
```

To run it outside Docker — which is what Claude Desktop does when it spawns the
process itself:

```bash
npm --prefix mcp ci
npm --prefix mcp run build
```

Get a token from **Settings → Workspace → AI assistant access** in Kernix. It needs the
`web-api` ability, which that screen grants; the browser-extension pairing flow issues
`extension-api` tokens, which the main API rejects. From the shell instead:

```bash
docker compose exec backend php artisan tinker --execute="echo App\Models\User::where('username','admin')->firstOrFail()->createToken('MCP', ['web-api'])->plainTextToken;"
```

Treat the output as a password. Anyone holding it can act as that account.

## How workspaces work

One deployment serves every workspace. There is no per-workspace instance, no
per-workspace configuration file, and no workspace setting on the server itself.

The **token decides the workspace**. Every token belongs to one Kernix account,
that account has an active workspace, and Kernix scopes every response to it.
Point two connections at the same URL with two different tokens and they see two
different companies — verified: a token from a second workspace returns zero
projects from the first and cannot open its tasks.

The same property makes the token the permission boundary. A connection acts as
whoever minted it: an owner's assistant sees the portfolio, a production
manager's sees their projects, an employee's sees their own work. Nobody gains
reach by pointing an assistant at Kernix.

Each person creates their own connection in Kernix under **Settings → Workspace →
AI assistant access**, which shows the endpoint, mints the token, and prints a
ready-to-paste config block for their client.

## Connecting Claude

Against a hosted deployment — the normal case, and what the settings screen prints:

```bash
claude mcp add --transport http kernix https://mcp.ibmclients.com/mcp \
  --header "Authorization: Bearer your-token-here"
```

Claude Desktop — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "kernix": {
      "type": "http",
      "url": "https://mcp.ibmclients.com/mcp",
      "headers": { "Authorization": "Bearer your-token-here" }
    }
  }
}
```

Running it locally as a spawned process instead, with the token in the environment:

```json
{
  "mcpServers": {
    "kernix": {
      "command": "node",
      "args": ["/absolute/path/to/Kernix/mcp/dist/index.js"],
      "env": {
        "KERNIX_BASE_URL": "http://localhost:8001",
        "KERNIX_API_TOKEN": "your-token-here"
      }
    }
  }
}
```

## Connecting ChatGPT

ChatGPT connectors fetch MCP over HTTP rather than spawning a process, so they need the
hosted endpoint. Add it under **Settings → Connectors** as a custom MCP connector:

```
URL:    https://mcp.ibmclients.com/mcp
Auth:   Bearer token
Token:  your-token-here
```

ChatGPT reaches the endpoint over the public internet, so it must be published over HTTPS —
a tunnel (`cloudflared`, `ngrok`) in front of the local port will do for testing.

## Writing

Reads are on by default; writes are not. Set `KERNIX_ALLOW_WRITES=1` to register the write tools.
When it is off they are not merely refused — they are never advertised, so an assistant cannot
call one by mistake.

Kernix refuses task changes unless the acting account has an open work session:

> Clock in before changing task work.

Two honest ways through it:

- **`kernix_clock_in`** — the assistant opens a real work session on the account. This records
  genuine attendance, so only do it when the person behind the account wants that, and clock out
  afterwards.
- **`KERNIX_ADMIN_OVERRIDE=1`** — task writes carry `admin_override`, which Kernix honours for
  administrators only. Nothing is recorded as attendance. This is the right choice for a
  dedicated automation account.

## Deploying to mcp.ibmclients.com

Run the container behind a TLS terminator and give Kernix the public address so the
settings screen prints something people can copy:

```bash
# In the Kernix .env
MCP_PUBLIC_URL=https://mcp.ibmclients.com/mcp

# On the MCP deployment
KERNIX_BASE_URL=https://app.ibmclients.com   # wherever the Kernix API answers
KERNIX_MCP_HOSTED=1                          # take the token from each request
KERNIX_MCP_HOST=0.0.0.0
KERNIX_MCP_PORT=8765
KERNIX_MCP_PUBLIC_URL=https://mcp.ibmclients.com/mcp
KERNIX_ALLOW_WRITES=1                        # a ceiling; roles still apply
```

Requirements the deployment has to meet:

- **HTTPS.** Tokens travel in the `Authorization` header on every call. ChatGPT will
  not accept a plain-HTTP connector at all.
- **Proxy the `Authorization` header through.** If the terminator strips it, every
  request answers 401 — this is the first thing to check when a connection that works
  locally fails in production.
- **`/healthz`** answers without a token and is the right liveness probe. `/mcp`
  answers 401 without one, which is not a failure.
- **Rate limiting at the edge** is worth having. The server holds no rate limit of its
  own, and Kernix's throttles are per-account.
- **No shared state**, so it scales horizontally: each request builds its own server
  instance and closes it when the response ends.

`MCP_PUBLIC_URL` only feeds the setup screen — it changes what people are told to copy,
never what the server accepts.

## Security

- The token is a live credential with the full authority of its account. Never commit it; prefer a
  dedicated account with a narrow role over an administrator.
- **Callers authenticate with their own Kernix token**, which the server forwards and never
  stores. In hosted mode a request without one is refused with 401 before any work is done, so
  reaching the endpoint grants nothing on its own.
- In `env` mode the process holds one token for everyone who can reach it. That is correct for
  stdio, where the client spawns the process, and wrong for a shared HTTP deployment — which is
  why hosted mode is the default whenever HTTP is used without an environment token.
- Reads are the default and writes are opt-in for the same reason: the blast radius of a confused
  assistant should be zero by default.
- Every refusal from Kernix is passed back verbatim, so a permission failure or a business-rule
  block reaches the assistant as an explanation it can act on rather than a generic error.

## Development

```bash
npm --prefix mcp run build      # compile
npm --prefix mcp run dev        # compile on change
npm --prefix mcp run check      # typecheck and build
```

`src/client.ts` is the API wrapper, `src/vocabulary.ts` the name/id resolver and workspace
timezone source, `src/format.ts` the renderer, and `src/tools/*.ts` the tool definitions grouped by
subject.

One subtlety worth preserving: Kernix serialises a due date as the UTC instant of local midnight,
so a task due 20 August in Manila arrives as `2026-08-19T16:00:00Z`. Reading the date off that
string reports every deadline a day early. `format.ts` converts through the workspace timezone
taken from `/api/bootstrap`; anything new that renders a date should go through `day()` rather
than slicing the string.
