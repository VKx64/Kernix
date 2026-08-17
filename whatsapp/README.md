# Kernix WhatsApp bridge

A small Node service that holds one WhatsApp account and nothing else. Kernix
sends through it, and it posts every inbound message to the Kernix API.

## Read this before linking an account

This uses [Baileys](https://github.com/WhiskeySockets/Baileys), an unofficial
WhatsApp Web client. WhatsApp does not sanction third-party clients, and it can
ban a number it decides is automated — permanently, without warning, and without
appeal. Consequences of that choice:

- Link a number the business can afford to lose. Not the one clients call.
- Expect breakage. WhatsApp changes its protocol whenever it likes; a bridge that
  works today can stop working after an update, and the fix is upstream.
- The official alternative is the Meta WhatsApp Cloud API. It needs a business
  number, Meta verification, and per-conversation fees, and it cannot use a
  number that is currently on a normal WhatsApp account. If those costs are
  acceptable, prefer it — `App\Services\WhatsAppClient` is the only file that
  would need to change on the Kernix side.

## What it does and does not do

It owns the socket. It does not decide anything: who a number belongs to, what a
message means, and whether the sender may do it are all resolved on the Laravel
side, where the permissions live. The bridge holds no database and no user.

Group chats are first-class, because that is where the studio and its clients
actually talk. For each inbound message the bridge reports three things Kernix
needs to tell a room from a person: the chat's jid, the *sender's* jid (they
differ in a group), and the group's subject, asked for once per group and then
remembered.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `KERNIX_WHATSAPP_TOKEN` | — (required) | Shared secret. Presented by Kernix on every call here, and by the bridge on the inbound callback. |
| `KERNIX_WHATSAPP_HOST` | `0.0.0.0` | Listen address. |
| `KERNIX_WHATSAPP_PORT` | `8790` | Listen port. |
| `KERNIX_WHATSAPP_AUTH_DIR` | `/app/auth` | Where the WhatsApp session is stored. Must be persistent. |
| `KERNIX_BASE_URL` | `http://backend:8000` | The Kernix API, container-to-container. |
| `KERNIX_WHATSAPP_INBOUND_PATH` | `/api/whatsapp/inbound` | Endpoint inbound messages are posted to. |
| `KERNIX_WHATSAPP_DEVICE_NAME` | `Kernix` | Name shown in WhatsApp's "linked devices" list. |
| `KERNIX_WHATSAPP_LOG_LEVEL` | `warn` | Pino log level. |

## HTTP surface

Every route except `/healthz` requires `Authorization: Bearer $KERNIX_WHATSAPP_TOKEN`.

| Route | Purpose |
| --- | --- |
| `GET /healthz` | Liveness, plus the current connection state. |
| `GET /status` | State, the linked number, and the pairing QR as a PNG data URL while a scan is outstanding. |
| `POST /pair` | Drop the stored session and offer a fresh QR. This is "link a different account". |
| `POST /logout` | Tell WhatsApp to forget this device, then wipe the local session. |
| `POST /send` | `{ "to": "639171234567", "text": "..." }`. Refuses with 409 when not linked. |

## Running it

Through Compose, as part of the stack:

```bash
docker compose up --build -d whatsapp
```

Then open workspace settings in Kernix, show the QR, and scan it from the phone
whose account will send and receive. The session survives restarts because it
lives in the `whatsapp_auth` volume; deleting that volume force-unlinks.

Locally, without Docker:

```bash
npm install
npm run build
KERNIX_WHATSAPP_TOKEN=dev-secret KERNIX_WHATSAPP_AUTH_DIR=./auth npm start
```

## Notes on behaviour

- Reconnects use an exponential backoff to a one-minute ceiling. WhatsApp treats
  a reconnect storm as abuse, so the socket is long-lived rather than per-request.
- A `loggedOut` disconnect wipes the credentials, because retrying a session
  WhatsApp has revoked never succeeds; the bridge then offers a new QR.
- Inbound posts retry twice on transport or 5xx faults. A 4xx is final: the
  backend has seen the message and refused it, which is a decision, not a fault.
- `status@broadcast` and the account's own messages are ignored. Everything else,
  group or not, is handed over — Kernix decides what to do with it, including
  saying nothing.
