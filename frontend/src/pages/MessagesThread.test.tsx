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
  task: { id: 9, title: 'Book the studio' },
  unread_count: 0,
  messages: [
    { id: 51, body: 'Can you take this?', author: me, assigned_user: casey, created_at: new Date().toISOString() },
    { id: 52, body: 'On it.', author: casey, assigned_user: me, created_at: new Date().toISOString() },
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
    expect(await screen.findByRole('link', { name: 'Book the studio' })).toHaveAttribute('href', '/tasks/9')
  })

  it('groups the thread under a day heading', async () => {
    renderThread()
    await waitFor(() => expect(screen.getByText('Today')).toBeInTheDocument())
    expect(screen.getAllByText('On it.').length).toBeGreaterThan(0)
  })

  it('sends a reply on Enter without a modifier', async () => {
    const actor = userEvent.setup()
    apiPost.mockResolvedValue({ data: {} })
    renderThread()
    await waitFor(() => expect(screen.getAllByText('On it.').length).toBeGreaterThan(0))

    await actor.type(screen.getByLabelText('Reply in this conversation'), 'Thanks{Enter}')

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/messages/5/replies', { body: 'Thanks' }))
  })
})
