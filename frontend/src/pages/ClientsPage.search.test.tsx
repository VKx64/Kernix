import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { ClientsPage } from './EntityPages'
import type { Client, User } from '../types/api'

/**
 * A search that matches nothing used to render the same empty state as a
 * workspace that has never had a client — "No clients yet", "Add the first
 * client account to begin", and a count of zero. People read that as their
 * client data having gone missing and add the records again.
 */

const authState = vi.hoisted(() => ({ user: null as User | null }))
const reload = vi.hoisted(() => vi.fn(async () => undefined))
const workspace = vi.hoisted(() => ({
  clients: [
    { id: 1, name: 'Acme Media' },
    { id: 2, name: 'Borealis Studio' },
  ] as Client[],
}))

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: authState.user, status: 'authenticated', login: vi.fn(), logout: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('../auth/WorkspaceProvider', () => ({
  useWorkspace: () => ({ singleClientMode: false, settings: {}, features: {} }),
}))

// Stands in for the API: the page has to react to what a query returns, so the
// mock filters rather than handing back a fixed list.
vi.mock('../lib/useCollection', () => ({
  useCollection: (_path: string, options: { search?: string; filters?: Record<string, unknown> } = {}) => {
    const query = (options.search ?? '').trim().toLowerCase()
    const archivedOnly = options.filters?.archived === 'only'
    const data = archivedOnly ? [] : workspace.clients.filter((client) => client.name.toLowerCase().includes(query))
    return {
      data,
      meta: { page: 1, perPage: 20, total: data.length, lastPage: 1 },
      loading: false,
      error: '',
      reload,
    }
  },
}))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/clients']}>
      <ClientsPage />
    </MemoryRouter>,
  )
}

describe('ClientsPage search', () => {
  beforeEach(() => {
    authState.user = { id: 2, username: 'producer', permissions: ['clients.view', 'clients.create'] }
    workspace.clients = [
      { id: 1, name: 'Acme Media' },
      { id: 2, name: 'Borealis Studio' },
    ] as Client[]
    reload.mockClear()
  })

  it('says the search matched nothing rather than that the workspace has no clients', async () => {
    const actor = userEvent.setup()
    renderPage()

    expect(screen.getByText('2 active client accounts.')).toBeInTheDocument()

    await actor.type(screen.getByLabelText('Search clients…'), 'zzzz-no-client')

    expect(await screen.findByRole('heading', { name: 'No clients match your search' })).toBeInTheDocument()
    expect(screen.getByText(/Nothing matches “zzzz-no-client”/)).toBeInTheDocument()
    // The count has to read as a filtered count, not as an empty workspace.
    expect(screen.getByText('0 active client accounts match your search.')).toBeInTheDocument()
    expect(screen.queryByText('No clients yet')).not.toBeInTheDocument()
    expect(screen.queryByText('Add the first client account to begin.')).not.toBeInTheDocument()
  })

  it('brings the client list back when the search is cleared', async () => {
    const actor = userEvent.setup()
    renderPage()

    const field = screen.getByLabelText('Search clients…')
    await actor.type(field, 'zzzz-no-client')
    await actor.click(await screen.findByRole('button', { name: 'Clear search' }))

    expect(field).toHaveValue('')
    expect(await screen.findByText('Acme Media')).toBeInTheDocument()
    expect(screen.getByText('Borealis Studio')).toBeInTheDocument()
    expect(screen.getByText('2 active client accounts.')).toBeInTheDocument()
  })

  it('narrows to the matches without claiming the rest were never there', async () => {
    const actor = userEvent.setup()
    renderPage()

    await actor.type(screen.getByLabelText('Search clients…'), 'acme')

    expect(await screen.findByText('Acme Media')).toBeInTheDocument()
    expect(screen.queryByText('Borealis Studio')).not.toBeInTheDocument()
    expect(screen.getByText('1 active client account matches your search.')).toBeInTheDocument()
  })

  it('keeps the first-run empty state for a workspace that really has no clients', () => {
    workspace.clients = []
    renderPage()

    expect(screen.getByRole('heading', { name: 'No clients yet' })).toBeInTheDocument()
    expect(screen.getByText('Add the first client account to begin.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument()
    expect(screen.getByText('0 active client accounts.')).toBeInTheDocument()
  })

  it('still explains an empty archive as an archive, not as a failed search', async () => {
    const actor = userEvent.setup()
    renderPage()

    await actor.click(screen.getByRole('switch', { name: 'Archived' }))

    expect(await screen.findByRole('heading', { name: 'No archived clients' })).toBeInTheDocument()
    expect(screen.getByText('Archived clients will appear here.')).toBeInTheDocument()
  })
})
