import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { MessagesPage } from './MessagesPage'

/**
 * The two-pane Messages screen: picking a conversation on the left, and what
 * the right pane does with it.
 *
 * The views are counted here rather than by the server, so the count and the
 * list it heads have to be checked together — a tab that says 1 while listing
 * two rows is the failure this guards against.
 */

const apiGet = vi.hoisted(() => vi.fn())
const apiPatch = vi.hoisted(() => vi.fn())
const apiPost = vi.hoisted(() => vi.fn())

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, api: { ...actual.api, get: apiGet, post: apiPost, patch: apiPatch } }
})

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 1, name: 'Me' } }) }))
vi.mock('../lib/permissions', () => ({ useCan: () => () => true }))

const me = { id: 1, name: 'Me' }
const casey = { id: 2, name: 'Casey Reyes' }
const priya = { id: 3, name: 'Priya Nair' }
const now = new Date().toISOString()

const conversations = [
  {
    id: 5,
    task: { id: 9, title: 'Book the studio' },
    unread_count: 2,
    latest_message: { id: 52, body: 'Studio is held for Friday.', author: casey, created_at: now },
    messages: [
      { id: 51, body: 'Can you book the studio?', author: me, assigned_user: casey, created_at: now },
      { id: 52, body: 'Studio is held for Friday.', author: casey, assigned_user: me, created_at: now },
    ],
  },
  {
    id: 6,
    task: { id: 11, title: 'Colour grade' },
    unread_count: 0,
    estimate_request: { id: 3, status: 'pending', requested_additional_minutes: 45, base_estimated_minutes: 120 },
    latest_message: { id: 61, body: 'Need 45 more minutes.', author: priya, created_at: now },
    messages: [{ id: 61, body: 'Need 45 more minutes.', author: priya, assigned_user: me, created_at: now }],
  },
]

function renderPage(entry = '/messages') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/messages" element={<MessagesPage />} />
        <Route path="/messages/:messageId" element={<MessagesPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

const views = () => screen.getByRole('navigation', { name: 'Conversation scope' })

beforeEach(() => {
  apiGet.mockReset(); apiPatch.mockReset(); apiPost.mockReset()
  apiPatch.mockResolvedValue({ data: { ...conversations[0], unread_count: 0 } })
  apiGet.mockImplementation(async (url: string) => {
    if (url === '/api/messages') return { data: conversations, meta: { current_page: 1, last_page: 1 } }
    if (url === '/api/messages/5') return { data: conversations[0] }
    if (url === '/api/messages/6') return { data: conversations[1] }
    return { data: [] }
  })
})

describe('the conversation list', () => {
  it('loads the thread of the conversation that is clicked', async () => {
    const actor = userEvent.setup()
    renderPage('/messages?view=all')

    await actor.click(await screen.findByRole('button', { name: /Casey Reyes/ }))

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/messages/5'))
    // Both sides of the thread, which only the detail payload carries.
    expect(await screen.findByText('Can you book the studio?')).toBeInTheDocument()
    expect(screen.getAllByText('Studio is held for Friday.').length).toBeGreaterThan(0)
  })

  it('badges an unread conversation with how many messages are waiting', async () => {
    renderPage('/messages?view=all')

    const row = await screen.findByRole('button', { name: /Casey Reyes/ })
    expect(within(row).getByText('2')).toBeInTheDocument()
    // The read conversation carries no badge at all.
    const other = screen.getByRole('button', { name: /Priya Nair/ })
    expect(within(other).queryByText('0')).not.toBeInTheDocument()
  })
})

describe('the scope tabs', () => {
  it('offers the four scopes the design specifies, in order', async () => {
    renderPage()

    const tabs = views()
    await waitFor(() => expect(within(tabs).getByRole('button', { name: /^All/ })).toBeInTheDocument())
    expect(within(tabs).getAllByRole('button').map((tab) => tab.textContent?.replace(/\d+$/, '')))
      .toEqual(['All', 'Team', 'Clients', 'Unread'])
  })

  it('carries no counts, as the design does not', async () => {
    renderPage()

    const tabs = views()
    await waitFor(() => expect(within(tabs).getByRole('button', { name: 'All' })).toBeInTheDocument())
    // A tab is a scope, not a metric. The unread count lives on the rows.
    expect(within(tabs).getAllByRole('button').map((tab) => tab.textContent)).toEqual(['All', 'Team', 'Clients', 'Unread'])
  })

  it('lists only the conversations in the chosen scope', async () => {
    const actor = userEvent.setup()
    renderPage()

    expect(await screen.findByText('Book the studio')).toBeInTheDocument()
    expect(screen.getByText('Colour grade')).toBeInTheDocument()

    await actor.click(within(views()).getByRole('button', { name: /^Unread/ }))
    await waitFor(() => expect(screen.queryByText('Colour grade')).not.toBeInTheDocument())
    expect(screen.getByText('Book the studio')).toBeInTheDocument()
  })
})

describe('the composer', () => {
  it('will not send until there is something to send', async () => {
    const actor = userEvent.setup()
    apiPost.mockResolvedValue({ data: {} })
    renderPage('/messages/5')

    const send = await screen.findByRole('button', { name: 'Send reply' })
    expect(send).toBeDisabled()

    await actor.type(screen.getByLabelText('Reply in this conversation'), 'On my way')
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeEnabled()

    await actor.click(screen.getByRole('button', { name: 'Send reply' }))
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/messages/5/replies', { body: 'On my way' }))
  })
})
