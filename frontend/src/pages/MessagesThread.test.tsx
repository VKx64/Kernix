import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { MessagesPage } from './MessagesPage'

const apiGet = vi.hoisted(() => vi.fn())
const apiPost = vi.hoisted(() => vi.fn())
const apiPatch = vi.hoisted(() => vi.fn())

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, api: { ...actual.api, get: apiGet, post: apiPost, patch: apiPatch } }
})

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 1, name: 'Me' } }) }))
vi.mock('../lib/permissions', () => ({ useCan: () => () => true }))

const me = { id: 1, name: 'Me' }
const casey = { id: 2, name: 'Casey Reyes' }
const conversation = {
  id: 5,
  task: { id: 9, title: 'Book the studio', project: { id: 3, name: 'Launch film' } },
  unread_count: 0,
  messages: [
    { id: 51, body: 'Can you take this?', author: me, assigned_user: casey, created_at: new Date().toISOString() },
    { id: 52, body: 'On it.', author: casey, assigned_user: me, created_at: new Date().toISOString(), reactions: [{ emoji: '👍', count: 1, mine: false }] },
  ],
}

function renderThread() {
  return render(
    <MemoryRouter initialEntries={['/messages/5']}>
      <Routes><Route path="/messages/:messageId" element={<MessagesPage />} /></Routes>
    </MemoryRouter>,
  )
}

describe('conversation thread', () => {
  beforeEach(() => {
    apiGet.mockReset(); apiPost.mockReset(); apiPatch.mockReset()
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/api/messages/5') return { data: conversation }
      if (url === '/api/messages') return { data: [{ ...conversation, latest_message: conversation.messages[1] }], meta: { current_page: 1, last_page: 1 } }
      return { data: [] }
    })
  })

  it('names the other person, not whoever spoke last', async () => {
    renderThread()

    // Both the list row and the conversation header identify Casey, never "Me".
    await waitFor(() => expect(screen.getAllByText('Casey Reyes').length).toBeGreaterThan(0))
    expect(screen.queryByRole('heading', { name: 'Me' })).not.toBeInTheDocument()
    // The subline still proves the right conversation loaded — its task,
    // named correctly — even with the task banner and its link gone.
    expect(await screen.findByText('Thread on Book the studio')).toBeInTheDocument()
  })

  it('carries no day separator, as the design has none', async () => {
    renderThread()
    await waitFor(() => expect(screen.getAllByText('On it.').length).toBeGreaterThan(0))
    expect(screen.queryByText('Today')).not.toBeInTheDocument()
    expect(screen.queryByText('Yesterday')).not.toBeInTheDocument()
  })

  it('sends a reply on Enter without a modifier', async () => {
    const actor = userEvent.setup()
    apiPost.mockResolvedValue({ data: {} })
    renderThread()
    await waitFor(() => expect(screen.getAllByText('On it.').length).toBeGreaterThan(0))

    await actor.type(screen.getByLabelText('Reply in this conversation'), 'Thanks{Enter}')

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/messages/5/replies', { body: 'Thanks' }))
  })

  it('summarises the thread and shows the result in a dismissable card', async () => {
    const actor = userEvent.setup()
    apiPost.mockResolvedValue({ data: { summary: 'Casey is handling the booking.' } })
    renderThread()
    await waitFor(() => expect(screen.getAllByText('On it.').length).toBeGreaterThan(0))

    await actor.click(screen.getByRole('button', { name: /Summarise/ }))

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/messages/5/ai', { kind: 'summary' }))
    expect(await screen.findByText('Casey is handling the booking.')).toBeInTheDocument()

    await actor.click(screen.getByRole('button', { name: 'Dismiss the thread summary' }))
    expect(screen.queryByText('Casey is handling the booking.')).not.toBeInTheDocument()
  })

  it('turns an extracted action item into a task', async () => {
    const actor = userEvent.setup()
    apiPost.mockImplementation(async (url: string) => {
      if (url === '/api/messages/5/ai') return { data: { items: [{ title: 'Confirm the studio address' }] } }
      return { data: {} }
    })
    renderThread()
    await waitFor(() => expect(screen.getAllByText('On it.').length).toBeGreaterThan(0))

    await actor.click(screen.getByRole('button', { name: /Action items/ }))
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/messages/5/ai', { kind: 'actions' }))

    const createButton = await screen.findByRole('button', { name: 'Create task' })
    await actor.click(createButton)

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/tasks', { title: 'Confirm the studio address', project_id: 3 }))
    expect(await screen.findByRole('button', { name: 'Added' })).toBeInTheDocument()
  })

  it('toggles a reaction on a message', async () => {
    const actor = userEvent.setup()
    apiPost.mockResolvedValue({ data: { ...conversation, messages: [conversation.messages[0], { ...conversation.messages[1], reactions: [{ emoji: '👍', count: 2, mine: true }] }] } })
    renderThread()
    await waitFor(() => expect(screen.getAllByText('On it.').length).toBeGreaterThan(0))

    await actor.click(screen.getByRole('button', { name: /👍\s*1/ }))

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/messages/5/notes/52/reactions', { emoji: '👍' }))
    expect(await screen.findByRole('button', { name: /👍\s*2/ })).toBeInTheDocument()
  })
})
