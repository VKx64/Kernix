import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { MessagesPage } from './MessagesPage'

const apiGet = vi.hoisted(() => vi.fn())
const apiPatch = vi.hoisted(() => vi.fn())

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, api: { ...actual.api, get: apiGet, post: vi.fn(), patch: apiPatch } }
})

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 1, name: 'Me' } }) }))
vi.mock('../lib/permissions', () => ({ useCan: () => () => true }))

const me = { id: 1, name: 'Me' }
const casey = { id: 2, name: 'Casey Reyes' }
const priya = { id: 3, name: 'Priya Nair' }
const now = new Date().toISOString()

// One unread reply, one read estimate request whose task is overdue and mine.
const conversations = [
  {
    id: 5,
    task: { id: 9, title: 'Book the studio' },
    unread_count: 1,
    latest_message: { id: 52, body: 'On it.', author: casey, created_at: now },
    messages: [{ id: 52, body: 'On it.', author: casey, assigned_user: me, created_at: now }],
  },
  {
    id: 6,
    task: { id: 11, title: 'Colour grade', due_date: '2020-01-01', assignee: me },
    unread_count: 0,
    estimate_request: { id: 3, status: 'pending', requested_additional_minutes: 45, base_estimated_minutes: 120 },
    latest_message: { id: 61, body: 'Need 45 more minutes.', author: priya, created_at: now },
    messages: [{ id: 61, body: 'Need 45 more minutes.', author: priya, assigned_user: me, created_at: now }],
  },
]

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/messages']}>
      <Routes><Route path="/messages" element={<MessagesPage />} /><Route path="/messages/:messageId" element={<MessagesPage />} /></Routes>
    </MemoryRouter>,
  )
}

describe('messages triage', () => {
  beforeEach(() => {
    apiGet.mockReset(); apiPatch.mockReset()
    apiPatch.mockResolvedValue({ data: {} })
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/api/messages') return { data: conversations, meta: { current_page: 1, last_page: 1 } }
      if (url === '/api/messages/5') return { data: conversations[0] }
      if (url === '/api/messages/6') return { data: conversations[1] }
      return { data: [] }
    })
  })

  const scopes = () => screen.getByRole('navigation', { name: 'Conversation scope' })

  it('counts each scope from the loaded conversations', async () => {
    renderPage()

    const tabs = scopes()
    await waitFor(() => expect(within(tabs).getByRole('button', { name: /^All/ })).toHaveTextContent('2'))
    // Every conversation is between workspace users, so Team holds all of
    // them and Clients holds none until client threads exist.
    expect(within(tabs).getByRole('button', { name: /^Team/ })).toHaveTextContent('2')
    expect(within(tabs).getByRole('button', { name: /^Clients/ })).toBeInTheDocument()
    expect(within(tabs).getByRole('button', { name: /^Unread/ })).toHaveTextContent('1')
  })

  it('opens on everything and narrows to unread on click', async () => {
    const actor = userEvent.setup()
    renderPage()

    await waitFor(() => expect(screen.getByText('Book the studio')).toBeInTheDocument())
    expect(screen.getByText('Colour grade')).toBeInTheDocument()

    await actor.click(within(scopes()).getByRole('button', { name: /^Unread/ }))
    await waitFor(() => expect(screen.queryByText('Colour grade')).not.toBeInTheDocument())
    expect(screen.getByText('Book the studio')).toBeInTheDocument()
  })

  it('says the Clients tab is a missing capability, not an empty inbox', async () => {
    const actor = userEvent.setup()
    renderPage()

    await waitFor(() => expect(screen.getByText('Book the studio')).toBeInTheDocument())
    await actor.click(within(scopes()).getByRole('button', { name: /^Clients/ }))

    expect(await screen.findByText('No client conversations')).toBeInTheDocument()
    expect(screen.getByText(/once client threads are connected/)).toBeInTheDocument()
  })

  it('marks the selected conversations read in bulk', async () => {
    const actor = userEvent.setup()
    renderPage()

    await actor.click(within(scopes()).getByRole('button', { name: /^All/ }))
    await actor.click(await screen.findByLabelText('Select all conversations'))
    expect(screen.getByText('2 selected')).toBeInTheDocument()

    await actor.click(screen.getByRole('button', { name: 'Read' }))
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/api/messages/5/read'))
    expect(apiPatch).toHaveBeenCalledWith('/api/messages/6/read')
  })

  it('decides an estimate request inside the thread', async () => {
    const actor = userEvent.setup()
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/api/messages') return { data: conversations, meta: { current_page: 1, last_page: 1 } }
      if (url === '/api/messages/6') return { data: { ...conversations[1], can_review: true } }
      return { data: [] }
    })
    render(
      <MemoryRouter initialEntries={['/messages/6']}>
        <Routes><Route path="/messages/:messageId" element={<MessagesPage />} /></Routes>
      </MemoryRouter>,
    )

    // No modal: the approve control lives in the thread next to the request.
    await actor.click(await screen.findByRole('button', { name: /Approve/ }))
    expect(screen.getByLabelText('Approved additional minutes')).toHaveValue(45)
    expect(screen.getByRole('button', { name: /Approve & update estimate/ })).toBeDisabled()
  })
})
