import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { MessagesPage } from './MessagesPage'

/**
 * Messages is two panes side by side. A phone has room for one of them, and
 * showing both put the placeholder pane over the inbox and half of it past the
 * right edge, where nothing could scroll to it. Below `md` the screen is one
 * pane: the inbox until a conversation is picked, the conversation after.
 *
 * jsdom has no viewport to measure, so the switch is asserted on the classes
 * that carry it rather than on geometry.
 */

const apiGet = vi.hoisted(() => vi.fn())

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, api: { ...actual.api, get: apiGet, post: vi.fn(), patch: vi.fn().mockResolvedValue({ data: {} }) } }
})

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 1, name: 'Me' } }) }))
vi.mock('../lib/permissions', () => ({ useCan: () => () => true }))

const me = { id: 1, name: 'Me' }
const casey = { id: 2, name: 'Casey Reyes' }
const now = new Date().toISOString()

const conversations = [
  {
    id: 5,
    task: { id: 9, title: 'Book the studio' },
    unread_count: 0,
    latest_message: { id: 52, body: 'On it.', author: casey, created_at: now },
    messages: [{ id: 52, body: 'On it.', author: casey, assigned_user: me, created_at: now }],
  },
]

function Elsewhere() {
  const location = useLocation()
  return <p>Left messages for {location.pathname}</p>
}

function renderPage(entry = '/messages') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/messages" element={<MessagesPage />} />
        <Route path="/messages/:messageId" element={<MessagesPage />} />
        <Route path="/oliver" element={<Elsewhere />} />
      </Routes>
    </MemoryRouter>,
  )
}

const inbox = () => document.querySelector('[data-pane="inbox"]') as HTMLElement
const conversation = () => document.querySelector('[data-pane="conversation"]') as HTMLElement

describe('messages mobile layout', () => {
  beforeEach(() => {
    apiGet.mockReset()
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/api/messages') return { data: conversations, meta: { current_page: 1, last_page: 1 } }
      if (url === '/api/messages/5') return { data: conversations[0] }
      return { data: [] }
    })
  })

  it('shows only the inbox on a phone while no conversation is open', async () => {
    renderPage()

    await waitFor(() => expect(screen.getByText('Book the studio')).toBeInTheDocument())

    // Full width and on screen below md; the desktop column returns at md.
    expect(inbox()).toHaveClass('flex', 'w-full', 'md:w-[292px]')
    expect(inbox()).not.toHaveClass('hidden')
    // The pane that was overlapping the list and running off the right edge.
    expect(conversation()).toHaveClass('hidden', 'md:flex')
  })

  it('swaps to the conversation once one is opened, and back again', async () => {
    const actor = userEvent.setup()
    renderPage()

    await actor.click(await screen.findByText('Book the studio'))

    await waitFor(() => expect(conversation()).not.toHaveClass('hidden'))
    expect(conversation()).toHaveClass('flex')
    expect(inbox()).toHaveClass('hidden', 'md:flex')

    // The inbox is off screen on a phone, so the way back cannot be in it.
    await actor.click(screen.getByRole('button', { name: 'Back to inbox' }))

    await waitFor(() => expect(inbox()).not.toHaveClass('hidden'))
    expect(conversation()).toHaveClass('hidden', 'md:flex')
  })

  it('keeps the scope that was being read on the way back to the inbox', async () => {
    const actor = userEvent.setup()
    renderPage('/messages/5?scope=unread')

    await actor.click(await screen.findByRole('button', { name: 'Back to inbox' }))

    await waitFor(() => expect(inbox()).not.toHaveClass('hidden'))
    expect(screen.getByRole('button', { name: 'Unread' })).toHaveClass('font-semibold')
  })

  it('offers no back control when there is nothing to go back from', async () => {
    renderPage()

    await waitFor(() => expect(screen.getByText('Book the studio')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Back to inbox' })).not.toBeInTheDocument()
    expect(screen.getByText('Select a conversation')).toBeInTheDocument()
  })

  it('does not strand the reader on a conversation that failed to open', async () => {
    const actor = userEvent.setup()
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/api/messages') return { data: conversations, meta: { current_page: 1, last_page: 1 } }
      throw new Error('Conversation not found.')
    })
    renderPage('/messages/5')

    // Not "Select a conversation" — one was selected, and it did not open.
    expect(await screen.findByText('This conversation could not be opened')).toBeInTheDocument()
    expect(screen.getByText('Conversation not found.')).toBeInTheDocument()

    await actor.click(screen.getByRole('button', { name: 'Back to inbox' }))
    await waitFor(() => expect(inbox()).not.toHaveClass('hidden'))
    expect(screen.getByText('Select a conversation')).toBeInTheDocument()
  })
})
