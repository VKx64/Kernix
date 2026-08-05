import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { MessagesPage } from './MessagesPage'

const apiGet = vi.hoisted(() => vi.fn())
const apiPost = vi.hoisted(() => vi.fn())

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, api: { ...actual.api, get: apiGet, post: apiPost, patch: vi.fn() } }
})

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 1, username: 'me' } }) }))
vi.mock('../lib/permissions', () => ({ useCan: () => () => true }))

function respond(url: string) {
  if (url === '/api/messages/recipients') return { data: [{ id: 2, name: 'Casey Reyes' }] }
  if (url === '/api/tasks') return { data: [{ id: 9, title: 'Book the studio', project: { id: 3, name: 'Launch film' } }], meta: { current_page: 1, last_page: 1 } }
  if (url === '/api/messages') return { data: [], meta: { current_page: 1, last_page: 1 } }
  return { data: {} }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/messages']}>
      <Routes><Route path="/messages" element={<MessagesPage />} /><Route path="/messages/:messageId" element={<MessagesPage />} /></Routes>
    </MemoryRouter>,
  )
}

describe('starting a new conversation', () => {
  beforeEach(() => {
    apiGet.mockReset(); apiPost.mockReset()
    apiGet.mockImplementation(async (url: string) => respond(url))
  })

  it('sends a message to a chosen person about a chosen task', async () => {
    const actor = userEvent.setup()
    apiPost.mockResolvedValue({ data: { id: 42, messages: [] } })
    renderPage()

    await actor.click(await screen.findByRole('button', { name: /New message/ }))
    await actor.click(await screen.findByRole('combobox', { name: 'Send to' }))
    await actor.click(await screen.findByRole('option', { name: 'Casey Reyes' }))
    await actor.click(screen.getByRole('combobox', { name: 'About task' }))
    await actor.click(await screen.findByRole('option', { name: /Book the studio/ }))
    await actor.type(screen.getByPlaceholderText('Write your message…'), 'Can you take this?')
    await actor.click(screen.getByRole('button', { name: /Send message/ }))

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/messages', {
      recipient_id: 2,
      task_id: 9,
      body: 'Can you take this?',
    }))
  })

  it('keeps the send button locked until a person, a task, and a message are all given', async () => {
    const actor = userEvent.setup()
    renderPage()

    await actor.click(await screen.findByRole('button', { name: /New message/ }))
    expect(await screen.findByRole('button', { name: /Send message/ })).toBeDisabled()
    await actor.type(screen.getByPlaceholderText('Write your message…'), 'Only a body')
    expect(screen.getByRole('button', { name: /Send message/ })).toBeDisabled()
  })
})
