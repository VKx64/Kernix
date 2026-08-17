import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { ErrorBanner, Panel } from '@/components/shared'
import { api, unwrap } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import type { ApiEnvelope } from '@/types/api'

interface BridgeStatus {
  configured: boolean
  state: string
  jid: string | null
  qr: string | null
  pair_code: string | null
  last_error: string | null
  connected_at: string | null
  trigger: string
}

interface ChatSummary {
  id: number
  jid: string
  kind: 'direct' | 'group'
  label: string
  number: string | null
  audience: 'staff' | 'client' | 'unknown'
  intake_enabled: boolean
  muted: boolean
  project: { id: number; name: string } | null
  client: { id: number; name: string } | null
  user: { id: number; name: string } | null
  contact: { id: number; name: string } | null
  last_inbound_at: string | null
}

interface ProjectOption {
  id: number
  name: string
}

const STATE_LABELS: Record<string, string> = {
  not_configured: 'No bridge configured',
  unreachable: 'Bridge unreachable',
  starting: 'Starting',
  connecting: 'Connecting',
  awaiting_scan: 'Waiting for a QR scan',
  open: 'Connected',
  closed: 'Disconnected',
  logged_out: 'Logged out of WhatsApp',
}

const AUDIENCE_LABELS: Record<ChatSummary['audience'], string> = {
  staff: 'Team',
  client: 'Client',
  unknown: 'Unrecognised',
}

function envelope<T>(payload: ApiEnvelope<T> | T): T {
  return unwrap(payload)
}

/**
 * The one WhatsApp account the studio speaks through, and what each chat on it
 * is.
 *
 * The directory is the part that earns its place. Numbers resolve themselves
 * against personnel and contact records, so team members and clients are named
 * without anybody enrolling — but a group chat is just an id until somebody says
 * which project it belongs to, and until then no work can be raised from it.
 * That mapping, and the switch that stops a chat being read at all, are the two
 * controls an operator actually needs.
 */
export function WhatsAppPanel() {
  const can = useCan()
  const mayManage = can('settings.edit')
  const maySee = can('settings.view')

  const [bridge, setBridge] = useState<BridgeStatus | null>(null)
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [notify, setNotify] = useState(true)
  const [pairPhone, setPairPhone] = useState('')
  const timer = useRef<number | null>(null)

  const loadBridge = useCallback(async () => {
    setBridge(envelope(await api.get<ApiEnvelope<BridgeStatus> | BridgeStatus>('/api/whatsapp/bridge')))
  }, [])

  const loadChats = useCallback(async () => {
    setChats(envelope(await api.get<ApiEnvelope<ChatSummary[]> | ChatSummary[]>('/api/whatsapp/chats')))
  }, [])

  const loadPreference = useCallback(async () => {
    const settings = envelope(
      await api.get<ApiEnvelope<{ notify_whatsapp: boolean }> | { notify_whatsapp: boolean }>('/api/me/settings'),
    )
    setNotify(Boolean(settings.notify_whatsapp))
  }, [])

  // Tolerated failure: somebody may hold settings permission without project
  // access, and the rest of this screen is still worth showing to them. They
  // simply cannot repoint a chat.
  const loadProjects = useCallback(async () => {
    try {
      const payload = await api.get<{ data?: ProjectOption[] } | ProjectOption[]>('/api/projects', { per_page: 'all' })
      const list = Array.isArray(payload) ? payload : (payload.data ?? [])
      setProjects(list.map((project) => ({ id: project.id, name: project.name })))
    } catch {
      setProjects([])
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      await Promise.all(
        maySee ? [loadBridge(), loadChats(), loadProjects(), loadPreference()] : [loadPreference()],
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load WhatsApp settings.')
    } finally {
      setLoading(false)
    }
  }, [loadBridge, loadChats, loadPreference, loadProjects, maySee])

  useEffect(() => {
    void load()
  }, [load])

  // WhatsApp rotates the pairing QR every twenty seconds or so, and a stale
  // square simply fails to scan, so an outstanding scan is refreshed.
  useEffect(() => {
    const waiting = bridge?.state === 'awaiting_scan' || bridge?.state === 'connecting'
    if (!waiting) {
      if (timer.current) window.clearInterval(timer.current)
      timer.current = null

      return
    }

    timer.current = window.setInterval(() => {
      void loadBridge().catch(() => undefined)
    }, 10_000)

    return () => {
      if (timer.current) window.clearInterval(timer.current)
      timer.current = null
    }
  }, [bridge?.state, loadBridge])

  const act = async (key: string, run: () => Promise<void>) => {
    setBusy(key)
    setError('')
    setNotice('')
    try {
      await run()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That did not work.')
    } finally {
      setBusy('')
    }
  }

  const pair = () =>
    act('pair', async () => {
      setBridge(envelope(await api.post<ApiEnvelope<BridgeStatus> | BridgeStatus>('/api/whatsapp/bridge/pair', {})))
      setNotice('Scan the QR below with the WhatsApp account that will speak for this workspace.')
    })

  const pairByNumber = () =>
    act('pair-code', async () => {
      setBridge(
        envelope(
          await api.post<ApiEnvelope<BridgeStatus> | BridgeStatus>('/api/whatsapp/bridge/pair-code', {
            phone: pairPhone,
          }),
        ),
      )
      setNotice('On the phone: WhatsApp → Linked devices → Link with phone number instead, then type the code below.')
    })

  const logout = () =>
    act('logout', async () => {
      setBridge(envelope(await api.post<ApiEnvelope<BridgeStatus> | BridgeStatus>('/api/whatsapp/bridge/logout', {})))
      setNotice('The workspace WhatsApp account has been unlinked.')
    })

  const patchChat = (chat: ChatSummary, body: Record<string, unknown>, key: string) =>
    act(`${key}-${chat.id}`, async () => {
      const updated = envelope(
        await api.patch<ApiEnvelope<ChatSummary> | ChatSummary>(`/api/whatsapp/chats/${chat.id}`, body),
      )
      setChats((current) => current.map((row) => (row.id === updated.id ? updated : row)))
    })

  const sendTest = (chat: ChatSummary) =>
    act(`test-${chat.id}`, async () => {
      await api.post(`/api/whatsapp/chats/${chat.id}/test`, {})
      setNotice(`Test message queued to ${chat.label}.`)
    })

  if (loading) {
    return (
      <Panel title="WhatsApp">
        <Skeleton className="h-24 w-full" />
      </Panel>
    )
  }

  const trigger = bridge?.trigger ?? 'kernix'

  return (
    <Panel
      title="WhatsApp"
      action={
        <Button size="sm" variant="outline" onClick={() => void load()}>
          Refresh
        </Button>
      }
    >
      <div className="space-y-6">
        {error && <ErrorBanner message={error} onRetry={() => void load()} />}
        {notice && <p className="rounded-md bg-muted px-3 py-2 text-sm">{notice}</p>}

        {maySee && (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-medium">The studio's account</h3>
                <p className="text-sm text-muted-foreground">
                  {STATE_LABELS[bridge?.state ?? ''] ?? bridge?.state ?? 'Unknown'}
                  {bridge?.jid ? ` — ${bridge.jid.split('@')[0]}` : ''}
                </p>
              </div>
              {mayManage && bridge?.configured && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={busy === 'pair'} onClick={() => void pair()}>
                    {bridge.state === 'open' ? 'Link another account' : 'Show QR'}
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy === 'logout'} onClick={() => void logout()}>
                    Unlink
                  </Button>
                </div>
              )}
            </div>

            {!bridge?.configured && (
              <p className="text-sm text-muted-foreground">
                No bridge is configured for this deployment. Set <code>WHATSAPP_BRIDGE_URL</code> and{' '}
                <code>WHATSAPP_BRIDGE_TOKEN</code>, and start the <code>whatsapp</code> service.
              </p>
            )}

            {mayManage && bridge?.configured && bridge.state !== 'open' && (
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">Pair by number instead</p>
                <p className="text-xs text-muted-foreground">
                  Easier than a rotating QR when the phone is not next to this screen. Full number with country code.
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  <Input
                    value={pairPhone}
                    placeholder="639170000000"
                    aria-label="Phone number to pair"
                    className="w-52"
                    onChange={(event) => setPairPhone(event.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === 'pair-code' || pairPhone.trim().length < 8}
                    onClick={() => void pairByNumber()}
                  >
                    {busy === 'pair-code' ? 'Asking WhatsApp…' : 'Get a pairing code'}
                  </Button>
                </div>
                {bridge.pair_code && (
                  <p className="text-sm">
                    Type this on the phone: <span className="font-mono text-base font-medium">{bridge.pair_code}</span>
                  </p>
                )}
              </div>
            )}

            {bridge?.qr && (
              <div className="space-y-2">
                <img
                  src={bridge.qr}
                  alt="WhatsApp pairing QR code"
                  className="h-56 w-56 rounded-md border bg-white p-2"
                />
                <p className="text-sm text-muted-foreground">
                  On the phone: WhatsApp → Settings → Linked devices → Link a device. The code refreshes on its own.
                </p>
              </div>
            )}

            {bridge?.last_error && bridge.state !== 'open' && (
              <p className="text-sm text-muted-foreground">Last error: {bridge.last_error}</p>
            )}

            <p className="text-xs text-muted-foreground">
              This connects a real WhatsApp account through an unofficial client. WhatsApp does not sanction that, and it
              can ban a number it decides is automated. Use a number the studio can afford to lose.
            </p>
          </section>
        )}

        {maySee && (
          <section className="space-y-3 border-t pt-4">
            <div>
              <h3 className="text-sm font-medium">Chats</h3>
              <p className="text-sm text-muted-foreground">
                Team members and client contacts are recognised by the numbers already on their records. A group needs a
                project before work can be raised from it — set it here, or say{' '}
                <code>{trigger} link project 12</code> in the group itself.
              </p>
            </div>

            {!chats.length && (
              <p className="text-sm text-muted-foreground">
                No chats yet. They appear as soon as somebody messages the account, or Kernix messages them.
              </p>
            )}

            <ul className="divide-y">
              {chats.map((chat) => (
                <li key={chat.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-48">
                    <p className="text-sm font-medium">
                      {chat.label}
                      <span className="ml-2 rounded-sm bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                        {chat.kind === 'group' ? 'Group' : AUDIENCE_LABELS[chat.audience]}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        chat.user?.name,
                        chat.contact?.name,
                        chat.client?.name,
                        chat.number,
                      ]
                        .filter(Boolean)
                        .join(' · ') || chat.jid}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      Project
                      <select
                        className="rounded-md border bg-background px-2 py-1 text-sm"
                        value={chat.project?.id ?? ''}
                        disabled={!mayManage || busy === `project-${chat.id}`}
                        onChange={(event) =>
                          void patchChat(
                            chat,
                            { project_id: event.target.value ? Number(event.target.value) : null },
                            'project',
                          )
                        }
                      >
                        <option value="">Not set</option>
                        {projects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      Read for work
                      <Switch
                        checked={chat.intake_enabled}
                        disabled={!mayManage || busy === `intake-${chat.id}`}
                        onCheckedChange={(next) => void patchChat(chat, { intake_enabled: next }, 'intake')}
                        aria-label={`Read ${chat.label} for work`}
                      />
                    </label>

                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      Muted
                      <Switch
                        checked={chat.muted}
                        disabled={!mayManage || busy === `mute-${chat.id}`}
                        onCheckedChange={(next) => void patchChat(chat, { muted: next }, 'mute')}
                        aria-label={`Mute ${chat.label}`}
                      />
                    </label>

                    {mayManage && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === `test-${chat.id}`}
                        onClick={() => void sendTest(chat)}
                      >
                        Test
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="space-y-3 border-t pt-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">Your own notifications</h3>
              <p className="text-xs text-muted-foreground">
                Task messages, assignments, what is due, and the end-of-day nudge, sent to the number on your profile.
                Replies and commands keep working either way.
              </p>
            </div>
            <Switch
              checked={notify}
              disabled={busy === 'notify'}
              aria-label="Send my notifications to WhatsApp"
              onCheckedChange={(next) =>
                void act('notify', async () => {
                  const settings = envelope(
                    await api.patch<ApiEnvelope<{ notify_whatsapp: boolean }> | { notify_whatsapp: boolean }>(
                      '/api/me/settings',
                      { notify_whatsapp: next },
                    ),
                  )
                  setNotify(Boolean(settings.notify_whatsapp))
                })
              }
            />
          </div>
        </section>
      </div>
    </Panel>
  )
}
