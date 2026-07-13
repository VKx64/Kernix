import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { ReactNode } from 'react'
import App from './App'
import type { User } from './types/api'

const authState = vi.hoisted(() => ({ user: null as User | null }))

vi.mock('./auth/AuthProvider', () => ({
  useAuth: () => ({ user: authState.user, status: 'authenticated', login: vi.fn(), logout: vi.fn(), refresh: vi.fn() }),
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}))

function json(data: unknown) {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => {
  const storage = new Map<string, string>()
  const localStorageMock = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
    removeItem: (key: string) => { storage.delete(key) },
    clear: () => storage.clear(),
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() { return storage.size },
  }
  Object.defineProperty(window, 'localStorage', { configurable: true, value: localStorageMock })
  vi.stubGlobal('localStorage', localStorageMock)
  vi.stubGlobal('fetch', vi.fn(async () => json({ data: {} })))
})

afterEach(() => vi.unstubAllGlobals())

describe('permission routes and navigation', () => {
  it('blocks a direct task URL without tasks.view', async () => {
    authState.user = { id: 1, username: 'viewer', permissions: ['dashboard.view'] }
    render(<MemoryRouter initialEntries={['/tasks']}><App /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'This area is not in your role.' })).toBeInTheDocument()
  })

  it('links Administration to the first allowed tab and hides task/time controls', async () => {
    authState.user = { id: 2, username: 'user-manager', permissions: ['dashboard.view', 'users.view'] }
    render(<MemoryRouter initialEntries={['/not-a-route']}><App /></MemoryRouter>)
    const administration = await screen.findByRole('link', { name: 'Administration' })
    expect(administration).toHaveAttribute('href', '/settings/users')
    expect(screen.getByText('Kernix')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/Search tasks/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clock in' })).not.toBeInTheDocument()
  })

  it('leaves only profile access when the server returns no valid grants', async () => {
    authState.user = { id: 3, username: 'corrupt-role', permissions: [] }
    render(<MemoryRouter initialEntries={['/settings/users']}><App /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Your role has no workspace access.' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open profile' })).toHaveAttribute('href', '/profile')
    expect(screen.queryByRole('link', { name: 'Administration' })).not.toBeInTheDocument()
  })
})
