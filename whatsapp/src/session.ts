import { readdir, rm } from 'node:fs/promises'
import type { Boom } from '@hapi/boom'
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys'
import type { WASocket, proto } from '@whiskeysockets/baileys'
import pino from 'pino'
import QRCode from 'qrcode'
import type { BridgeConfig } from './config.js'

export type LinkState = 'starting' | 'awaiting_scan' | 'connecting' | 'open' | 'closed' | 'logged_out'

export interface SessionStatus {
  state: LinkState
  /** The linked account's own number, once WhatsApp has told us. */
  jid: string | null
  /** A PNG data URL of the pairing QR, present only while `state` is `awaiting_scan`. */
  qr: string | null
  /** The 8-character code to type into WhatsApp, when pairing by number was asked for. */
  pair_code: string | null
  last_error: string | null
  connected_at: string | null
}

export interface InboundMessage {
  /** The conversation: a person's number, or a group id. */
  jid: string
  /**
   * Who spoke, as a phone-number jid wherever one could be found. WhatsApp now
   * addresses many groups by `@lid` — an id that deliberately hides the number —
   * so this is resolved from the group's participant list when it has to be.
   */
  sender_jid: string
  /** The raw `@lid` the message carried, when it had one. */
  sender_lid: string | null
  /** Sent by the linked account itself, i.e. by the person holding the phone. */
  from_me: boolean
  /** A group's subject line, so Kernix can show the room by name. Null one to one. */
  chat_subject: string | null
  wa_message_id: string
  text: string
  push_name: string | null
  is_group: boolean
  /** Seconds since the epoch, as WhatsApp reported it. */
  timestamp: number
}

/**
 * One WhatsApp account, held open for the life of the container.
 *
 * WhatsApp allows a limited number of linked devices per account and treats a
 * reconnect storm as abuse, so the socket is long-lived and reconnects with a
 * backoff rather than per request. Credentials live in `authDir` on a volume:
 * losing that directory means scanning the QR again, and deleting it is exactly
 * how an operator unlinks.
 */
export class WhatsAppSession {
  private socket: WASocket | null = null

  private state: LinkState = 'starting'

  private qr: string | null = null

  private jid: string | null = null

  private lastError: string | null = null

  private connectedAt: Date | null = null

  /** Set while somebody is pairing by phone number rather than by QR. */
  private pendingPhone: string | null = null

  private pairCode: string | null = null

  private reconnectAttempts = 0

  /** Whether this process has ever got as far as a working connection. */
  private everOpened = false

  private reconnectTimer: NodeJS.Timeout | null = null

  private stopped = false

  /**
   * Group subjects, cached for the life of the process. Asking WhatsApp for
   * metadata on every message in a busy group is a request per line, and the
   * name of a group changes about once a year.
   */
  private readonly groupSubjects = new Map<string, string>()

  /**
   * `@lid` to phone-number jid, per group, with the time it was read.
   *
   * WhatsApp is moving group addressing to LIDs, which carry no number at all.
   * Kernix identifies people by the numbers on their records, so a LID has to be
   * turned back into a number, and the only place that mapping exists is the
   * group's own participant list.
   */
  private readonly lidMaps = new Map<string, { at: number; map: Map<string, string> }>()

  /** Ids of messages this bridge sent, so its own replies are not read back in. */
  private readonly sentIds = new Set<string>()

  private readonly logger = pino({ level: process.env.KERNIX_WHATSAPP_LOG_LEVEL?.trim() || 'warn' })

  constructor(
    private readonly config: BridgeConfig,
    private readonly onMessage: (message: InboundMessage) => void,
  ) {}

  status(): SessionStatus {
    return {
      state: this.state,
      jid: this.jid,
      qr: this.state === 'awaiting_scan' ? this.qr : null,
      pair_code: this.state === 'open' ? null : this.pairCode,
      last_error: this.lastError,
      connected_at: this.connectedAt?.toISOString() ?? null,
    }
  }

  async start(): Promise<void> {
    this.stopped = false
    await this.connect()
  }

  /** Drop the credentials and come back with a fresh QR. This is "link a different account". */
  async reset(): Promise<void> {
    this.clearReconnect()
    await this.closeSocket()
    await this.clearAuth()
    this.pendingPhone = null
    this.pairCode = null
    this.jid = null
    this.connectedAt = null
    this.lastError = null
    this.reconnectAttempts = 0
    await this.connect()
  }

  /** Tell WhatsApp to forget this device, then wipe the local credentials. */
  async logout(): Promise<void> {
    this.clearReconnect()
    try {
      await this.socket?.logout()
    } catch (reason) {
      this.logger.warn({ reason }, 'logout call failed; wiping credentials anyway')
    }
    await this.closeSocket()
    await this.clearAuth()
    this.state = 'logged_out'
    this.jid = null
    this.qr = null
    this.pairCode = null
    this.pendingPhone = null
    this.connectedAt = null
  }

  /**
   * Pair by typing a code into the phone instead of scanning.
   *
   * Kinder than a QR in practice: the QR rotates every twenty seconds and this
   * one is read off a screen that may be nowhere near the phone. The code is
   * asked for as soon as WhatsApp offers pairing, which is the point at which the
   * socket is known to be up and unregistered.
   */
  async pairWithNumber(phone: string): Promise<void> {
    const digits = phone.replace(/\D+/g, '')
    if (digits.length < 8) {
      throw Object.assign(new Error('A full phone number, with country code, is required.'), { status: 422 })
    }

    this.pendingPhone = digits
    this.pairCode = null
    await this.reset()
    this.pendingPhone = digits
  }

  async send(to: string, text: string): Promise<string> {
    if (this.state !== 'open' || !this.socket) {
      throw Object.assign(new Error(`WhatsApp is not linked (state: ${this.state}).`), { status: 409 })
    }

    const jid = normalizeJid(to)
    const sent = await this.socket.sendMessage(jid, { text })
    const id = sent?.key?.id ?? ''

    if (id) {
      this.sentIds.add(id)
      // Bounded: this only has to outlive the echo of a message we just sent.
      if (this.sentIds.size > 300) {
        this.sentIds.delete(this.sentIds.values().next().value as string)
      }
    }

    return id
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.clearReconnect()
    await this.closeSocket()
  }

  private async connect(): Promise<void> {
    if (this.stopped) {
      return
    }

    const { state, saveCreds } = await useMultiFileAuthState(this.config.authDir)
    this.state = 'connecting'

    const socket = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: this.logger,
      // A minute per QR rather than twenty seconds for every one after the
      // first: this code is scanned off a browser somebody has to walk to.
      qrTimeout: 60_000,
      // History is a large, slow sync the bridge has no use for: it acts on
      // messages that arrive from now on.
      syncFullHistory: false,
      markOnlineOnConnect: false,
      browser: [this.config.deviceName, 'Chrome', '1.0.0'],
    })
    this.socket = socket

    socket.ev.on('creds.update', () => {
      void saveCreds()
    })

    socket.ev.on('connection.update', (update) => {
      void this.onConnectionUpdate(update)
    })

    socket.ev.on('messages.upsert', (event) => {
      if (event.type !== 'notify') {
        return
      }
      for (const message of event.messages) {
        void this.handleIncoming(message)
      }
    })
  }

  private async onConnectionUpdate(update: {
    connection?: string
    lastDisconnect?: { error?: Error | undefined; date: Date } | undefined
    qr?: string | undefined
  }): Promise<void> {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      this.qr = await QRCode.toDataURL(qr, { margin: 1, width: 320 })
      this.state = 'awaiting_scan'
      await this.requestPendingPairCode()
    }

    if (connection === 'open') {
      this.state = 'open'
      this.qr = null
      this.lastError = null
      this.connectedAt = new Date()
      this.reconnectAttempts = 0
      this.everOpened = true
      this.jid = this.socket?.user?.id ?? null
      this.pairCode = null
      this.pendingPhone = null
      this.logger.info({ jid: this.jid }, 'whatsapp linked')

      return
    }

    if (connection !== 'close') {
      return
    }

    const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode

    // WhatsApp always closes the stream immediately after a successful pairing
    // and expects the client to come straight back with the new credentials. It
    // is the handshake finishing, not a fault, so it is neither reported as an
    // error nor counted against the session — counting it could let the rule
    // below throw away credentials that were seconds old.
    if (statusCode === DisconnectReason.restartRequired) {
      this.logger.info('restart required after pairing; reconnecting')
      this.state = 'connecting'
      this.scheduleReconnect(500)

      return
    }

    this.lastError = lastDisconnect?.error?.message ?? null

    // Logged out means the credentials are dead: keeping them would retry a
    // session WhatsApp has already revoked, so they go and a fresh QR is
    // offered instead.
    // WhatsApp hands out a fixed number of pairing refs and closes the socket
    // once they are used up. There are no credentials to protect in that state,
    // so it reconnects at once for a fresh set rather than backing off — waiting
    // a minute would just show a dead QR for a minute.
    if (statusCode === DisconnectReason.timedOut && !this.jid) {
      this.state = 'connecting'
      this.scheduleReconnect(1_000)

      return
    }

    // A session file that is present but not usable — pairing that was
    // interrupted half way, or credentials WhatsApp has invalidated — reconnects
    // for ever without ever emitting a QR, because stored credentials suppress
    // pairing. Retrying that is hopeless, so after a few goes with nothing to
    // show for them the credentials are dropped and pairing starts over.
    if (statusCode === DisconnectReason.badSession || (! this.everOpened && this.reconnectAttempts >= 3)) {
      this.logger.warn({ statusCode }, 'stored session cannot connect; starting pairing again')
      await this.clearAuth()
      this.reconnectAttempts = 0
      this.state = 'connecting'
      this.scheduleReconnect(1_000)

      return
    }

    if (statusCode === DisconnectReason.loggedOut) {
      await this.clearAuth()
      this.state = 'logged_out'
      this.jid = null
      this.connectedAt = null
      this.scheduleReconnect(2_000)

      return
    }

    this.state = 'closed'
    this.connectedAt = null
    this.scheduleReconnect()
  }

  private async handleIncoming(message: proto.IWebMessageInfo): Promise<void> {
    const jid = message.key?.remoteJid ?? ''
    if (!jid || jid === 'status@broadcast') {
      return
    }

    const id = message.key?.id ?? ''
    const fromMe = Boolean(message.key?.fromMe)

    // The bridge's own replies come back as sent messages. Reading them would be
    // a conversation with itself.
    if (fromMe && id && this.sentIds.has(id)) {
      return
    }

    const isGroup = jid.endsWith('@g.us')

    const text = extractText(message)
    if (!text) {
      return
    }

    // Whoever spoke: a group message carries a participant, a one-to-one message
    // is the chat itself, and anything sent from the linked phone is the account
    // holder. Kernix still decides whether a person's own message means anything
    // — it only acts on one that addresses it by name.
    const raw = fromMe
      ? this.ownNumberJid()
      : (message.key?.participant ?? jid)
    const lid = raw?.endsWith('@lid') ? raw : null
    const senderJid = lid && isGroup ? ((await this.phoneForLid(jid, lid)) ?? lid) : (raw ?? jid)

    this.onMessage({
      jid,
      chat_subject: isGroup ? await this.groupSubject(jid) : null,
      sender_jid: stripDevice(senderJid),
      sender_lid: lid,
      from_me: fromMe,
      wa_message_id: id,
      text,
      push_name: message.pushName ?? null,
      is_group: isGroup,
      timestamp: Number(message.messageTimestamp ?? 0),
    })
  }

  /** The linked account's own number, without WhatsApp's device suffix. */
  private ownNumberJid(): string {
    return stripDevice(this.jid ?? this.socket?.user?.id ?? '')
  }

  /**
   * The phone-number jid behind a `@lid`, read from the group's participant list.
   *
   * Cached for five minutes: the list changes when somebody joins or leaves, and
   * a miss re-reads it, so a new member is picked up on their first message
   * rather than being anonymous until the cache expires.
   */
  private async phoneForLid(groupJid: string, lid: string): Promise<string | null> {
    const cached = this.lidMaps.get(groupJid)
    const fresh = cached && Date.now() - cached.at < 5 * 60_000
    const hit = cached?.map.get(lid)
    if (hit && fresh) {
      return hit
    }

    try {
      const metadata = await this.socket?.groupMetadata(groupJid)
      const map = new Map<string, string>()
      for (const participant of metadata?.participants ?? []) {
        const phone = participant.jid ?? (participant.id?.endsWith('@s.whatsapp.net') ? participant.id : undefined)
        const participantLid = participant.lid ?? (participant.id?.endsWith('@lid') ? participant.id : undefined)
        if (phone && participantLid) {
          map.set(participantLid, phone)
        }
      }
      this.lidMaps.set(groupJid, { at: Date.now(), map })

      return map.get(lid) ?? hit ?? null
    } catch (reason) {
      this.logger.warn({ reason, groupJid }, 'could not read group participants for lid mapping')

      return hit ?? null
    }
  }

  /** The group's name, asked for once and then remembered. */
  private async groupSubject(jid: string): Promise<string | null> {
    const cached = this.groupSubjects.get(jid)
    if (cached !== undefined) {
      return cached
    }

    try {
      const metadata = await this.socket?.groupMetadata(jid)
      const subject = metadata?.subject?.trim()
      if (subject) {
        this.groupSubjects.set(jid, subject)

        return subject
      }
    } catch (reason) {
      this.logger.warn({ reason, jid }, 'could not read group subject')
    }

    return null
  }

  private scheduleReconnect(delayMs?: number): void {
    if (this.stopped || this.reconnectTimer) {
      return
    }

    this.reconnectAttempts += 1
    const backoff = delayMs ?? Math.min(60_000, 2_000 * 2 ** Math.min(this.reconnectAttempts - 1, 5))
    this.logger.warn({ backoff, attempt: this.reconnectAttempts }, 'reconnecting to whatsapp')

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect().catch((reason: unknown) => {
        this.lastError = reason instanceof Error ? reason.message : String(reason)
        this.state = 'closed'
        this.scheduleReconnect()
      })
    }, backoff)
  }

  /**
   * Asked for once per pairing attempt, at the first `qr` event — that is the
   * moment WhatsApp is offering pairing, so the socket is up and this account is
   * not registered yet.
   */
  private async requestPendingPairCode(): Promise<void> {
    if (!this.pendingPhone || this.pairCode || !this.socket) {
      return
    }

    try {
      this.pairCode = await this.socket.requestPairingCode(this.pendingPhone)
      this.pendingPhone = null
      this.logger.info('pairing code issued')
    } catch (reason) {
      this.pendingPhone = null
      this.lastError = reason instanceof Error ? reason.message : String(reason)
      this.logger.warn({ reason }, 'could not get a pairing code; scan the QR instead')
    }
  }

  /**
   * Empties the credentials directory without removing it. The directory is a
   * mounted volume: removing the mount point itself fails with EACCES no matter
   * who owns it, and an unhandled rejection there takes the whole bridge down.
   */
  private async clearAuth(): Promise<void> {
    try {
      for (const entry of await readdir(this.config.authDir)) {
        await rm(`${this.config.authDir}/${entry}`, { recursive: true, force: true })
      }
    } catch (reason) {
      const code = (reason as { code?: string })?.code
      if (code !== 'ENOENT') {
        this.logger.warn({ reason }, 'could not clear the credentials directory')
      }
    }
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private async closeSocket(): Promise<void> {
    const socket = this.socket
    this.socket = null
    this.state = 'closed'
    try {
      socket?.ev.removeAllListeners('connection.update')
      socket?.ev.removeAllListeners('messages.upsert')
      socket?.end(undefined)
    } catch (reason) {
      this.logger.warn({ reason }, 'closing socket failed')
    }
  }
}

/** `639524729243:27@s.whatsapp.net` is the same person as `639524729243@s.whatsapp.net`. */
export function stripDevice(jid: string): string {
  const [user, server] = jid.split('@')

  return server ? `${(user ?? '').split(':')[0]}@${server}` : jid
}

/** Accepts `639171234567`, `+63 917 123 4567`, or an already-formed jid. */
export function normalizeJid(value: string): string {
  const trimmed = value.trim()
  if (trimmed.includes('@')) {
    return trimmed
  }

  const digits = trimmed.replace(/\D+/g, '')
  if (!digits) {
    throw Object.assign(new Error('A recipient number is required.'), { status: 422 })
  }

  return `${digits}@s.whatsapp.net`
}

function extractText(message: proto.IWebMessageInfo): string {
  const content = message.message
  if (!content) {
    return ''
  }

  return (
    content.conversation ??
    content.extendedTextMessage?.text ??
    content.imageMessage?.caption ??
    content.videoMessage?.caption ??
    content.documentMessage?.caption ??
    content.buttonsResponseMessage?.selectedDisplayText ??
    content.listResponseMessage?.title ??
    ''
  ).trim()
}
