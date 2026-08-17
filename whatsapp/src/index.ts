import { timingSafeEqual } from 'node:crypto'
import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import { loadConfig } from './config.js'
import { WhatsAppSession, normalizeJid } from './session.js'
import type { InboundMessage } from './session.js'

const config = loadConfig()

/**
 * Inbound messages are handed to Kernix, not interpreted here. The bridge owns
 * the WhatsApp socket and nothing else: every decision about who a number
 * belongs to and what a message means lives in the Laravel side, where the
 * permissions are.
 */
async function forward(message: InboundMessage): Promise<void> {
  const url = `${config.backendUrl}${config.inboundPath}`

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Bearer ${config.token}`,
        },
        body: JSON.stringify(message),
      })

      if (response.ok) {
        return
      }

      // A rejected message is not retried: the backend has seen it and said no
      // (unknown sender, feature off). Only transport and server faults retry.
      if (response.status < 500) {
        console.warn(`inbound rejected: ${response.status} ${await response.text()}`)

        return
      }

      console.warn(`inbound failed with ${response.status}, attempt ${attempt}`)
    } catch (reason) {
      console.warn(`inbound post failed on attempt ${attempt}:`, reason)
    }

    await new Promise((resolve) => setTimeout(resolve, attempt * 1_000))
  }
}

const session = new WhatsAppSession(config, (message) => {
  void forward(message)
})

const app = express()
app.use(express.json({ limit: '256kb' }))

app.get('/healthz', (_request: Request, response: Response) => {
  response.json({ ok: true, state: session.status().state })
})

function authorize(request: Request, response: Response, next: NextFunction): void {
  const header = request.header('authorization') ?? ''
  const presented = header.startsWith('Bearer ') ? header.slice(7) : ''
  const expected = config.token

  const presentedBuffer = Buffer.from(presented)
  const expectedBuffer = Buffer.from(expected)
  const matches =
    presentedBuffer.length === expectedBuffer.length && timingSafeEqual(presentedBuffer, expectedBuffer)

  if (!matches) {
    response.status(401).json({ message: 'Unauthorized.' })

    return
  }

  next()
}

app.use(authorize)

app.get('/status', (_request: Request, response: Response) => {
  response.json(session.status())
})

/** Start over with a new QR, i.e. link a different WhatsApp account. */
app.post('/pair', (_request: Request, response: Response) => {
  void session
    .reset()
    .then(() => response.json(session.status()))
    .catch((reason: unknown) => fail(response, reason))
})

/**
 * Pair by number: WhatsApp shows "Link with phone number instead", and this is
 * the code to type there. Easier to get right than a rotating QR read off a
 * screen in another room.
 */
app.post('/pair-code', (request: Request, response: Response) => {
  const phone = typeof request.body?.phone === 'string' ? request.body.phone : ''

  void session
    .pairWithNumber(phone)
    .then(() => waitForPairCode())
    .then(() => response.json(session.status()))
    .catch((reason: unknown) => fail(response, reason))
})

app.post('/logout', (_request: Request, response: Response) => {
  void session
    .logout()
    .then(() => response.json(session.status()))
    .catch((reason: unknown) => fail(response, reason))
})

app.post('/send', (request: Request, response: Response) => {
  const to = typeof request.body?.to === 'string' ? request.body.to : ''
  const text = typeof request.body?.text === 'string' ? request.body.text : ''

  if (!to || !text.trim()) {
    response.status(422).json({ message: 'Both `to` and `text` are required.' })

    return
  }

  void session
    .send(to, text)
    .then((id) => response.json({ wa_message_id: id, to: normalizeJid(to) }))
    .catch((reason: unknown) => fail(response, reason))
})

/**
 * The code is issued a moment after the socket comes up, so the request waits for
 * it rather than making the caller poll. Ten seconds is generous; past that the
 * caller gets the status as it stands and can read the QR instead.
 */
async function waitForPairCode(): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (session.status().pair_code) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

function fail(response: Response, reason: unknown): void {
  const status = typeof (reason as { status?: number })?.status === 'number' ? (reason as { status: number }).status : 500
  const message = reason instanceof Error ? reason.message : 'The WhatsApp bridge failed.'
  console.error('bridge error:', reason)
  response.status(status).json({ message })
}

// A WhatsApp socket fails in ways that surface as rejected promises deep inside
// the library. Left unhandled, Node kills the process and the container restarts,
// which loses a pairing session that was halfway done — so they are logged and
// the reconnect logic is left to do its job.
process.on('unhandledRejection', (reason) => {
  console.error('unhandled rejection:', reason)
})

process.on('uncaughtException', (error) => {
  console.error('uncaught exception:', error)
})

const server = app.listen(config.port, config.host, () => {
  console.log(`Kernix WhatsApp bridge listening on ${config.host}:${config.port}`)
  void session.start().catch((reason: unknown) => console.error('failed to start whatsapp session:', reason))
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void session.stop().finally(() => server.close(() => process.exit(0)))
  })
}
