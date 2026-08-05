import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { RolesPage } from './EntityPages'
import type { Role, User } from '../types/api'

const authState = vi.hoisted(() => ({ user: null as User | null }))
const reload = vi.hoisted(() => vi.fn(async () => undefined))
const roleState = vi.hoisted(() => ({
  role: { id: 4, name: 'Producer', key: 'producer', permissions: ['dashboard.view'], users_count: 2 } as Role,
}))
const apiGet = vi.hoisted(() => vi.fn(async () => ({
  data: [
    { group: 'Dashboard', permissions: [{ key: 'dashboard.view', label: 'View dashboard', description: 'Open the dashboard.', requires: [] }] },
    { group: 'Time', permissions: [{ key: 'time.track', label: 'Track own time', description: 'Use the timer.', requires: [] }] },
  ],
})))
const apiPatch = vi.hoisted(() => vi.fn(async () => ({
  data: { ...roleState.role, permissions: ['dashboard.view', 'time.track'], affected_users_count: 2, sessions_revoked: true },
})))

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: authState.user, status: 'authenticated', login: vi.fn(), logout: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('../lib/useCollection', () => ({
  useCollection: () => ({ data: [roleState.role], meta: { page: 1, perPage: 20, total: 1, lastPage: 1 }, loading: false, error: '', reload }),
}))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    api: { ...actual.api, get: apiGet, patch: apiPatch, post: vi.fn(), delete: vi.fn() },
  }
})

describe('role permission session messaging', () => {
  beforeEach(() => {
    authState.user = { id: 1, username: 'admin', is_admin: true, permissions: [] }
    apiGet.mockClear()
    apiPatch.mockClear()
    reload.mockClear()
  })

  it('confirms the affected-user count and reports successful sign-out after permission changes', async () => {
    const actor = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<MemoryRouter initialEntries={['/settings/roles']}><RolesPage /></MemoryRouter>)

    // The permission catalog arrives after the first paint and re-renders the
    // table, so the row action has to be looked up again once it has settled.
    await screen.findByRole('button', { name: 'Edit' })
    await waitFor(() => expect(apiGet).toHaveBeenCalled())
    await actor.click(screen.getByRole('button', { name: 'Edit' }))

    await actor.click(await screen.findByRole('checkbox', { name: /Track own time/i }))
    await actor.click(screen.getByRole('button', { name: 'Save role' }))

    expect(confirm).toHaveBeenCalledWith('Save these permission changes? 2 affected users will be signed out immediately.')
    expect(await screen.findByText('Role updated. 2 affected users were signed out.')).toBeInTheDocument()
    expect(apiPatch).toHaveBeenCalledWith('/api/roles/4', expect.objectContaining({ permissions: expect.arrayContaining(['dashboard.view', 'time.track']) }))
  })
})
