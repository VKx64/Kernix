import { permissionPattern } from './origin'
import { badgeForState } from './state'
import type {
  BootstrapState,
  ExtensionTask,
  StoredState,
  TaskPage,
  TimeAction,
  WorkerError,
  WorkerRequest,
  WorkerResponse,
} from './types'

const REFRESH_ALARM = 'refresh-work-state'
const STORAGE_KEYS: Array<keyof StoredState> = [
  'workspaceOrigin',
  'deviceId',
  'token',
  'tokenExpiresAt',
  'lastBootstrap',
  'lastSyncAt',
]

class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ApiError'
  }
}

async function storedState(): Promise<StoredState> {
  return await chrome.storage.local.get(STORAGE_KEYS) as StoredState
}

function errorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object') {
    const value = payload as { message?: string; errors?: Record<string, string[]> }
    if (value.message) return value.message
    const first = value.errors && Object.values(value.errors).flat()[0]
    if (first) return first
  }
  return status === 401 ? 'Your extension access has expired. Pair the extension again.' : 'The request could not be completed.'
}

async function apiRequest<T>(path: string, options: RequestInit = {}, auth = true): Promise<T> {
  const stored = await storedState()
  if (!stored.workspaceOrigin || (auth && !stored.token)) throw new ApiError('Pair the extension with your workspace first.', 401)
  const headers = new Headers(options.headers)
  headers.set('Accept', 'application/json')
  headers.set('X-Requested-With', 'XMLHttpRequest')
  if (auth && stored.token) headers.set('Authorization', `Bearer ${stored.token}`)
  if (options.body) headers.set('Content-Type', 'application/json')

  let response: Response
  try {
    response = await fetch(`${stored.workspaceOrigin}${path}`, { ...options, headers, credentials: 'omit' })
  } catch {
    throw new ApiError('The workspace is unreachable. Check your connection and workspace URL.', 0)
  }
  const contentType = response.headers.get('content-type') ?? ''
  const payload = response.status === 204
    ? null
    : contentType.includes('application/json') ? await response.json() : await response.text()
  if (!response.ok) throw new ApiError(errorMessage(payload, response.status), response.status)
  if (
    payload
    && typeof payload === 'object'
    && !Array.isArray(payload)
    && 'data' in payload
    && !('meta' in payload)
  ) {
    return (payload as { data: T }).data
  }
  return payload as T
}

async function applyBadge(state?: BootstrapState | null, stale = false) {
  const badge = badgeForState(stale ? 'stale' : state?.time?.state)
  await Promise.all([
    chrome.action.setBadgeText({ text: badge.text }),
    chrome.action.setBadgeBackgroundColor({ color: badge.color }),
    chrome.action.setTitle({ title: badge.title }),
  ])
}

async function clearToken(preserveOrigin = true) {
  const current = await storedState()
  await chrome.storage.local.clear()
  if (preserveOrigin && current.workspaceOrigin) {
    await chrome.storage.local.set({ workspaceOrigin: current.workspaceOrigin, deviceId: current.deviceId })
  }
}

async function refreshBootstrap(allowCached = true): Promise<BootstrapState> {
  const stored = await storedState()
  if (!stored.workspaceOrigin || !stored.token) throw new ApiError('Pair the extension with your workspace first.', 401)
  try {
    const bootstrap = await apiRequest<BootstrapState>('/api/extension/bootstrap')
    const synced = new Date().toISOString()
    const value = { ...bootstrap, stale: false, last_synced_at: synced }
    await chrome.storage.local.set({ lastBootstrap: bootstrap, lastSyncAt: synced })
    await applyBadge(value)
    return value
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      await clearToken(true)
      await applyBadge(null, true)
      throw error
    }
    await applyBadge(stored.lastBootstrap, true)
    if (allowCached && stored.lastBootstrap) {
      return { ...stored.lastBootstrap, stale: true, last_synced_at: stored.lastSyncAt }
    }
    throw error
  }
}

async function pair(origin: string, code: string, deviceName: string): Promise<BootstrapState> {
  const current = await storedState()
  const deviceId = current.deviceId ?? crypto.randomUUID()
  await chrome.storage.local.set({ workspaceOrigin: origin, deviceId })
  try {
    const pairing = await apiRequest<{
      token: string
      expires_at: string
    }>('/api/extension/pairings/exchange', {
      method: 'POST',
      body: JSON.stringify({ code, device_name: `${deviceName} · ${deviceId.slice(0, 8)}` }),
    }, false)
    await chrome.storage.local.set({ token: pairing.token, tokenExpiresAt: pairing.expires_at })
    await chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 1 })
    return await refreshBootstrap(false)
  } catch (error) {
    await clearToken(true)
    throw error
  }
}

async function tasks(search: string, page: number): Promise<TaskPage> {
  const params = new URLSearchParams()
  if (search.trim()) params.set('search', search.trim())
  params.set('page', String(page))
  return await apiRequest<TaskPage>(`/api/extension/tasks?${params.toString()}`)
}

async function updateStatus(taskId: number, statusId: number): Promise<ExtensionTask> {
  const task = await apiRequest<ExtensionTask>(`/api/extension/tasks/${taskId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status_value_id: statusId }),
  })
  await refreshBootstrap(false)
  return task
}

async function addNote(taskId: number, body: string, minutes: number) {
  const note = await apiRequest(`/api/extension/tasks/${taskId}/notes`, {
    method: 'POST',
    body: JSON.stringify({ body, time_minutes: minutes }),
  })
  await refreshBootstrap(false)
  return note
}

async function timeAction(action: TimeAction): Promise<BootstrapState> {
  await apiRequest(`/api/extension/time/${action}`, { method: 'POST' })
  return await refreshBootstrap(false)
}

async function disconnect() {
  const stored = await storedState()
  let warning: string | undefined
  if (stored.token) {
    try {
      await apiRequest('/api/extension/session', { method: 'DELETE' })
    } catch (error) {
      warning = error instanceof Error ? `${error.message} Revoke the device from your web profile if needed.` : 'Revoke the device from your web profile if needed.'
    }
  }
  if (stored.workspaceOrigin) {
    await chrome.permissions.remove({ origins: [permissionPattern(stored.workspaceOrigin)] }).catch(() => false)
  }
  await chrome.storage.local.clear()
  await chrome.alarms.clear(REFRESH_ALARM)
  await applyBadge(null)
  return { disconnected: true, warning }
}

function asWorkerError(error: unknown): WorkerError {
  if (error instanceof ApiError) {
    return {
      code: error.status === 401 ? 'AUTH' : error.status === 0 ? 'NETWORK' : 'API',
      message: error.message,
      status: error.status || undefined,
    }
  }
  return { code: 'UNKNOWN', message: error instanceof Error ? error.message : 'An unexpected extension error occurred.' }
}

export async function handleMessage(message: WorkerRequest): Promise<WorkerResponse> {
  try {
    const data = await (async () => {
      switch (message.type) {
        case 'PAIR': return await pair(message.origin, message.code, message.deviceName)
        case 'BOOTSTRAP': return await refreshBootstrap()
        case 'TASKS_QUERY': return await tasks(message.search, message.page)
        case 'TASK_STATUS_UPDATE': return await updateStatus(message.taskId, message.statusId)
        case 'TASK_NOTE_ADD': return await addNote(message.taskId, message.body, message.minutes)
        case 'TIME_ACTION': return await timeAction(message.action)
        case 'DISCONNECT': return await disconnect()
      }
    })()
    return { ok: true, data }
  } catch (error) {
    const value = asWorkerError(error)
    if (value.code === 'AUTH' && !(await storedState()).token) value.code = 'UNPAIRED'
    return { ok: false, error: value }
  }
}

chrome.runtime.onMessage.addListener((message: WorkerRequest, _sender, sendResponse: (response: WorkerResponse) => void) => {
  void handleMessage(message).then(sendResponse)
  return true
})

async function ensureAlarmAndRefresh() {
  const stored = await storedState()
  if (!stored.token) {
    await applyBadge(null)
    return
  }
  await chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 1 })
  await refreshBootstrap().catch(() => undefined)
}

chrome.runtime.onInstalled.addListener(() => { void ensureAlarmAndRefresh() })
chrome.runtime.onStartup.addListener(() => { void ensureAlarmAndRefresh() })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) void refreshBootstrap().catch(() => undefined)
})

void ensureAlarmAndRefresh()
