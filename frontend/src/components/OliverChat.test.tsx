import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OliverChat } from './OliverChat'

const apiGet = vi.hoisted(() => vi.fn())
const apiPost = vi.hoisted(() => vi.fn())

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, api: { ...actual.api, get: apiGet, post: apiPost, delete: vi.fn() } }
})

describe('OliverChat', () => {
  beforeEach(() => {
    apiGet.mockReset()
    apiPost.mockReset()
    apiGet.mockResolvedValue({ data: { available: true, messages: [] } })
  })

  it('offers examples before anything has been said', async () => {
    render(<OliverChat />)

    expect(await screen.findByText(/Ask Oliver about the work/)).toBeInTheDocument()
    expect(screen.getByLabelText('Message Oliver')).toBeEnabled()
  })

  it('sends a message and shows what Oliver changed', async () => {
    const actor = userEvent.setup()
    apiPost.mockResolvedValue({
      data: {
        message: {
          id: 7,
          role: 'assistant',
          body: 'Created the studio booking and assigned it to Casey.',
          actions: [
            { type: 'create_task', status: 'done', summary: 'Created “Book the studio”' },
            { type: 'assign_task', status: 'refused', summary: 'You do not have permission for that change.' },
          ],
        },
      },
    })
    render(<OliverChat />)

    await actor.type(await screen.findByLabelText('Message Oliver'), 'Book the studio please')
    await actor.click(screen.getByRole('button', { name: /Send/ }))

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/oliver/messages', { body: 'Book the studio please' }))
    expect(screen.getByText('Book the studio please')).toBeInTheDocument()
    expect(await screen.findByText('Created “Book the studio”')).toBeInTheDocument()
    expect(screen.getByText('You do not have permission for that change.')).toBeInTheDocument()
  })

  it('locks the composer when Oliver is switched off', async () => {
    apiGet.mockResolvedValue({ data: { available: false, messages: [] } })
    render(<OliverChat />)

    await waitFor(() => expect(screen.getByLabelText('Message Oliver')).toBeDisabled())
    expect(screen.getByText(/Unavailable until AI is configured/)).toBeInTheDocument()
  })
})
