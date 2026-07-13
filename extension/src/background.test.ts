import { beforeEach, describe, expect, it, vi } from 'vitest'
import { storageState } from './test/setup'
import { handleMessage } from './background'

const bootstrap = {
  user: { id: 7, username: 'kylle', name: 'Kylle User' },
  permissions: ['time.track', 'tasks.view', 'tasks.change_status', 'tasks.comment', 'tasks.log_time'],
  workspace: { name: 'Kernix', origin: 'https://kernix.example.com' },
  time: { state: 'working', started_at: '2026-07-14T08:00:00Z', today_minutes: 15, can_mutate_tasks: true },
  task_statuses: [{ id: 1, label: 'Pending', key: 'pending', color: '#64748b' }],
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

describe('service worker orchestration', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })

  it('exchanges a pairing code, keeps the token in extension storage, and returns only bootstrap state', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(json({ data: { token: '1|secret', expires_at: '2026-10-12T00:00:00Z' } }))
      .mockResolvedValueOnce(json({ data: bootstrap }))

    const response = await handleMessage({ type: 'PAIR', origin: 'https://kernix.example.com', code: 'ABCDE-FGHIJ', deviceName: 'Chrome on Windows' })

    expect(response.ok).toBe(true)
    expect(storageState.token).toBe('1|secret')
    expect(response).not.toHaveProperty('data.token')
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://kernix.example.com/api/extension/pairings/exchange', expect.any(Object))
  })

  it('clears an expired token and marks the extension unpaired on 401', async () => {
    Object.assign(storageState, { workspaceOrigin: 'https://kernix.example.com', token: 'expired' })
    vi.mocked(fetch).mockResolvedValueOnce(json({ message: 'Unauthenticated.' }, 401))

    const response = await handleMessage({ type: 'BOOTSTRAP' })

    expect(response).toMatchObject({ ok: false, error: { code: 'UNPAIRED' } })
    expect(storageState.token).toBeUndefined()
    expect(storageState.workspaceOrigin).toBe('https://kernix.example.com')
  })

  it('routes time actions through the API and refreshes authoritative state', async () => {
    Object.assign(storageState, { workspaceOrigin: 'https://kernix.example.com', token: 'valid' })
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ data: bootstrap.time }))
      .mockResolvedValueOnce(json({ data: bootstrap }))

    const response = await handleMessage({ type: 'TIME_ACTION', action: 'break-start' })

    expect(response.ok).toBe(true)
    expect(vi.mocked(fetch)).toHaveBeenNthCalledWith(1, 'https://kernix.example.com/api/extension/time/break-start', expect.objectContaining({ method: 'POST' }))
  })

  it('keeps the pagination wrapper when loading assigned tasks', async () => {
    Object.assign(storageState, { workspaceOrigin: 'https://kernix.example.com', token: 'valid' })
    const page = {
      data: [{ id: 42, title: 'Assigned task', estimated_minutes: 30, actual_minutes: 5 }],
      meta: { current_page: 1, last_page: 1, per_page: 25, total: 1 },
    }
    vi.mocked(fetch).mockResolvedValueOnce(json(page))

    const response = await handleMessage({ type: 'TASKS_QUERY', search: '', page: 1 })

    expect(response).toEqual({ ok: true, data: page })
  })
})
