import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { SettingsNav, UsersPage } from './EntityPages'
import type { User } from '../types/api'

const authState = vi.hoisted(() => ({ user: null as User | null }))
const reload = vi.hoisted(() => vi.fn(async () => undefined))
const collectionState = vi.hoisted(() => ({
  data: [] as User[],
  meta: { page: 1, perPage: 20, total: 0, lastPage: 1 },
  loading: false,
  error: '',
  reload,
}))
const apiGet = vi.hoisted(() => vi.fn(async (path: string) => path === '/api/bootstrap'
  ? { data: { clients: [], coworkers: [], roles: [], fields: [] } }
  : { data: [], current_page: 1, last_page: 1, per_page: 100, total: 0 }))

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: authState.user, status: 'authenticated', login: vi.fn(), logout: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('../lib/useCollection', () => ({
  useCollection: () => collectionState,
}))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, api: { ...actual.api, get: apiGet } }
})

describe('administration permission controls', () => {
  beforeEach(() => {
    authState.user = {
      id: 2,
      username: 'manager',
      first_name: 'User',
      last_name: 'Manager',
      role_id: 2,
      role: { id: 2, name: 'User managers', key_name: 'user_managers' },
      permissions: ['dashboard.view', 'users.view', 'users.create', 'users.edit', 'users.archive', 'roles.view'],
    }
    collectionState.data = []
    collectionState.meta = { page: 1, perPage: 20, total: 0, lastPage: 1 }
    reload.mockClear()
    apiGet.mockClear()
  })

  it('renders only Administration tabs granted to the current role', () => {
    render(<MemoryRouter initialEntries={['/settings/users']}><SettingsNav /></MemoryRouter>)

    expect(screen.getByRole('link', { name: 'Users' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Roles' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'System' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Fields' })).not.toBeInTheDocument()
  })

  it('keeps administrator, self, role, password, and private-field restrictions visible for a delegated user manager', async () => {
    const actor = userEvent.setup()
    collectionState.data = [
      { id: 1, username: 'admin', first_name: 'Ada', last_name: 'Admin', role: { id: 1, name: 'Administrator', key_name: 'admin' }, is_admin: true },
      authState.user!,
      { id: 3, username: 'worker', first_name: 'Casey', last_name: 'Worker', role: { id: 2, name: 'User managers', key_name: 'user_managers' }, status: 'active' },
    ]
    collectionState.meta = { page: 1, perPage: 20, total: 3, lastPage: 1 }

    render(<MemoryRouter initialEntries={['/settings/users']}><UsersPage /></MemoryRouter>)

    const adminRow = screen.getByText('@admin').closest('tr')
    const selfRow = screen.getByText('@manager').closest('tr')
    const workerRow = screen.getByText('@worker').closest('tr')
    expect(adminRow).not.toBeNull()
    expect(selfRow).not.toBeNull()
    expect(workerRow).not.toBeNull()

    expect(within(adminRow!).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(within(adminRow!).queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()
    expect(within(selfRow!).getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(within(selfRow!).queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()
    expect(within(workerRow!).getByRole('button', { name: 'Archive' })).toBeInTheDocument()

    await actor.click(within(workerRow!).getByRole('button', { name: 'Edit' }))
    expect(await screen.findByRole('heading', { name: 'Edit user' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Role')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Personal email')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/New password/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Status')).toBeInTheDocument()
  })
})
