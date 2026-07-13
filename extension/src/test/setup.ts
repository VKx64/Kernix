import { beforeEach, vi } from 'vitest'

export const storageState: Record<string, unknown> = {}

const local = {
  get: vi.fn(async (keys?: string | string[]) => {
    if (!keys) return { ...storageState }
    const list = Array.isArray(keys) ? keys : [keys]
    return Object.fromEntries(list.filter((key) => key in storageState).map((key) => [key, storageState[key]]))
  }),
  set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(storageState, values) }),
  clear: vi.fn(async () => { Object.keys(storageState).forEach((key) => delete storageState[key]) }),
  remove: vi.fn(async (keys: string | string[]) => { (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete storageState[key]) }),
}

const chromeMock = {
  storage: { local },
  action: {
    setBadgeText: vi.fn(async () => undefined),
    setBadgeBackgroundColor: vi.fn(async () => undefined),
    setTitle: vi.fn(async () => undefined),
  },
  alarms: {
    create: vi.fn(async () => undefined),
    clear: vi.fn(async () => true),
    onAlarm: { addListener: vi.fn() },
  },
  runtime: {
    onMessage: { addListener: vi.fn() },
    onInstalled: { addListener: vi.fn() },
    onStartup: { addListener: vi.fn() },
    sendMessage: vi.fn(),
  },
  permissions: {
    request: vi.fn(async () => true),
    remove: vi.fn(async () => true),
  },
  tabs: { create: vi.fn(async () => ({})) },
}

Object.defineProperty(globalThis, 'chrome', { value: chromeMock, configurable: true })

beforeEach(() => {
  Object.keys(storageState).forEach((key) => delete storageState[key])
  vi.clearAllMocks()
})
