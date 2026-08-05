import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfilePage } from './ProfilePage'

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'admin', name: 'Admin User', first_name: 'Admin', last_name: 'User', status: 'active' },
    refresh: vi.fn(async () => undefined),
  }),
}))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, api: apiMocks }
})

describe('Profile browser extension management', () => {
  beforeEach(() => {
    apiMocks.get.mockResolvedValue({ data: [{
      id: 9,
      name: 'Chrome on Windows',
      created_at: '2026-07-14T08:00:00Z',
      last_used_at: '2026-07-14T09:00:00Z',
      expires_at: '2026-10-12T08:00:00Z',
    }] })
    apiMocks.post.mockResolvedValue({ data: { code: 'ABCDE-FGHIJ', expires_at: '2026-07-14T10:10:00Z' } })
    apiMocks.delete.mockResolvedValue(null)
  })

  it('generates a one-time code and lists and revokes paired devices', async () => {
    const actor = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    render(<ProfilePage />)

    expect(await screen.findByText('Chrome on Windows')).toBeInTheDocument()
    await actor.click(screen.getByRole('button', { name: 'Generate pairing code' }))
    expect(await screen.findByRole('button', { name: 'ABCDE-FGHIJ' })).toBeInTheDocument()
    await actor.click(screen.getByRole('button', { name: 'ABCDE-FGHIJ' }))
    expect(writeText).toHaveBeenCalledWith('ABCDE-FGHIJ')

    await actor.click(screen.getByRole('button', { name: 'Revoke' }))
    const confirmation = await screen.findByRole('alertdialog')
    expect(confirmation).toHaveTextContent('Chrome on Windows')
    await actor.click(within(confirmation).getByRole('button', { name: 'Revoke' }))

    await waitFor(() => expect(apiMocks.delete).toHaveBeenCalledWith('/api/extension/devices/9'))
    expect(screen.queryByText('Chrome on Windows')).not.toBeInTheDocument()
  })
})
