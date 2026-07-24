import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import App from '../App'
import { ApiError } from '../lib/api'
import { InviteAcceptPage } from './InviteAcceptPage'
import type { User } from '../types/api'

const authState = vi.hoisted(() => ({
  status: 'guest' as 'guest' | 'authenticated',
  user: null as User | null,
}))
const refresh = vi.hoisted(() => vi.fn(async () => ({ id: 7, username: 'new-person' } as User)))
const apiGet = vi.hoisted(() => vi.fn())
const apiPost = vi.hoisted(() => vi.fn())
const apiCsrf = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: authState.user, status: authState.status, login: vi.fn(), logout: vi.fn(), refresh }),
}))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, api: { ...actual.api, get: apiGet, post: apiPost, csrf: apiCsrf } }
})

const preview = {
  data: {
    email: 'new.person@example.com',
    role: { id: 4, name: 'Producer' },
    projects: [{ id: 12, name: 'Launch campaign' }],
    expires_at: '2026-07-23T12:00:00Z',
  },
}

beforeEach(() => {
  authState.status = 'guest'
  authState.user = null
  refresh.mockClear()
  apiGet.mockReset()
  apiGet.mockResolvedValue(preview)
  apiPost.mockReset()
  apiPost.mockResolvedValue({ data: { id: 7, username: 'new-person' } })
  apiCsrf.mockClear()
})

describe('invitation acceptance', () => {
  it('keeps the token route public for signed-out invitees', async () => {
    render(<MemoryRouter initialEntries={['/invite/secret-token']}><App /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: 'Welcome to Kernix' })).toBeInTheDocument()
    expect(screen.getByText('new.person@example.com')).toBeInTheDocument()
    expect(screen.getByText('Producer')).toBeInTheDocument()
    expect(screen.getByText('Launch campaign')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Sign in to your workspace' })).not.toBeInTheDocument()
  })

  it('creates the account, refreshes authentication, and enters the workspace', async () => {
    const actor = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/invite/secret-token']}>
        <Routes>
          <Route path="/invite/:token" element={<InviteAcceptPage />} />
          <Route path="/" element={<h1>Workspace opened</h1>} />
        </Routes>
      </MemoryRouter>,
    )

    await screen.findByRole('heading', { name: 'Welcome to Kernix' })
    await actor.type(screen.getByLabelText('First name'), 'New')
    await actor.type(screen.getByLabelText('Last name'), 'Person')
    await actor.type(screen.getByLabelText('Username'), 'new-person')
    await actor.type(screen.getByLabelText('Password'), 'very-secret')
    await actor.type(screen.getByLabelText('Confirm password'), 'very-secret')
    await actor.click(screen.getByRole('button', { name: /Create account/i }))

    await waitFor(() => expect(apiCsrf).toHaveBeenCalledOnce())
    expect(apiPost).toHaveBeenCalledWith('/api/invitations/secret-token/accept', {
      first_name: 'New',
      last_name: 'Person',
      username: 'new-person',
      password: 'very-secret',
      password_confirmation: 'very-secret',
    })
    expect(refresh).toHaveBeenCalledOnce()
    expect(await screen.findByRole('heading', { name: 'Workspace opened' })).toBeInTheDocument()
  })

  it('shows an unavailable state for an expired or already-used link', async () => {
    apiGet.mockRejectedValueOnce(new ApiError('This invitation has expired.', 410))

    render(
      <MemoryRouter initialEntries={['/invite/expired-token']}>
        <Routes><Route path="/invite/:token" element={<InviteAcceptPage />} /></Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'This link can’t be used.' })).toBeInTheDocument()
    expect(screen.getByText('This invitation has expired.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login')
  })
})
