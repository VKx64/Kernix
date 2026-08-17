import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WhatsAppPanel } from './WhatsAppPanel'

/**
 * The panel has to make one shared WhatsApp account legible: which account is
 * linked, and what each chat on it is. The mapping from a group chat to a project
 * is the load-bearing control — without it no work can be raised from that
 * conversation — so these pin that it is offered, saved, and kept away from
 * anybody without settings permission.
 */

const state = vi.hoisted(() => ({
  permitted: true,
  bridge: {} as Record<string, unknown>,
  chats: [] as Array<Record<string, unknown>>,
  settings: { notify_whatsapp: true },
}))

const apiGet = vi.hoisted(() => vi.fn(async (path: string): Promise<unknown> => {
  if (path === '/api/whatsapp/bridge') return { data: state.bridge }
  if (path === '/api/whatsapp/chats') return { data: state.chats }
  if (path === '/api/me/settings') return { data: state.settings }
  if (path === '/api/projects') return { data: [{ id: 12, name: 'Northwind app' }] }
  throw new Error(`Unexpected GET ${path}`)
}))

const apiPost = vi.hoisted(() => vi.fn(async (path: string): Promise<unknown> => {
  if (path === '/api/whatsapp/bridge/pair') {
    return { data: { configured: true, state: 'awaiting_scan', jid: null, qr: 'data:image/png;base64,AAA', trigger: 'kernix' } }
  }
  if (path.endsWith('/test')) return { data: { queued: true } }
  throw new Error(`Unexpected POST ${path}`)
}))

const apiPatch = vi.hoisted(() => vi.fn(async (path: string, body?: unknown): Promise<unknown> => {
  if (path.startsWith('/api/whatsapp/chats/')) {
    return {
      data: {
        ...state.chats[0],
        ...(body as Record<string, unknown>),
        project: { id: 12, name: 'Northwind app' },
      },
    }
  }
  if (path === '/api/me/settings') return { data: { notify_whatsapp: false } }
  throw new Error(`Unexpected PATCH ${path}`)
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, get: apiGet, post: apiPost, patch: apiPatch } }
})

vi.mock('@/lib/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/permissions')>()
  return { ...actual, useCan: () => () => state.permitted }
})

const groupChat = {
  id: 7,
  jid: '120363000000000001@g.us',
  kind: 'group',
  label: 'Northwind build',
  number: null,
  audience: 'unknown',
  intake_enabled: true,
  muted: false,
  project: null,
  client: null,
  user: null,
  contact: null,
  last_inbound_at: '2026-08-18T09:00:00+08:00',
}

describe('WhatsAppPanel', () => {
  beforeEach(() => {
    apiGet.mockClear()
    apiPost.mockClear()
    apiPatch.mockClear()
    state.permitted = true
    state.bridge = { configured: true, state: 'open', jid: '639170000000@s.whatsapp.net', qr: null, last_error: null, trigger: 'kernix' }
    state.chats = [groupChat]
    state.settings = { notify_whatsapp: true }
  })

  it('shows the linked account and the chats on it', async () => {
    render(<WhatsAppPanel />)

    expect(await screen.findByText('Connected', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Northwind build')).toBeInTheDocument()
    expect(screen.getByText('Group')).toBeInTheDocument()
  })

  it('saves the project a group chat belongs to', async () => {
    render(<WhatsAppPanel />)

    const select = await screen.findByRole('combobox')
    expect(select).toHaveValue('')

    await userEvent.selectOptions(select, '12')

    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith('/api/whatsapp/chats/7', { project_id: 12 }),
    )
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('12'))
  })

  it('stops a chat being read for work without muting it', async () => {
    render(<WhatsAppPanel />)

    await userEvent.click(await screen.findByRole('switch', { name: 'Read Northwind build for work' }))

    expect(apiPatch).toHaveBeenCalledWith('/api/whatsapp/chats/7', { intake_enabled: false })
  })

  it('never asks the bridge or the directory for anything without settings permission', async () => {
    state.permitted = false
    render(<WhatsAppPanel />)

    await screen.findByText('Your own notifications')
    expect(apiGet).not.toHaveBeenCalledWith('/api/whatsapp/bridge')
    expect(apiGet).not.toHaveBeenCalledWith('/api/whatsapp/chats')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('renders the QR returned by a pairing request', async () => {
    state.bridge = { configured: true, state: 'closed', jid: null, qr: null, last_error: null, trigger: 'kernix' }
    render(<WhatsAppPanel />)

    await userEvent.click(await screen.findByRole('button', { name: 'Show QR' }))

    expect(await screen.findByAltText('WhatsApp pairing QR code')).toHaveAttribute('src', 'data:image/png;base64,AAA')
  })
})
