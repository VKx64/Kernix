import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { WorkRequestInbox } from './WorkRequestInbox'

/**
 * The queue a manager decides from. What matters here is that it stays out of
 * the way when it has nothing to say, that it never appears for somebody who
 * cannot decide, and that declining insists on a reason — a refusal with no
 * explanation is the thing this whole flow exists to avoid.
 */

const state = vi.hoisted(() => ({
  permissions: [] as string[],
  pending: [] as Array<Record<string, unknown>>,
}))
const apiGet = vi.hoisted(() => vi.fn(async () => ({ data: state.pending })))
const apiPost = vi.hoisted(() => vi.fn(async () => ({ data: {} })))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, get: apiGet, post: apiPost } }
})

vi.mock('@/lib/permissions', () => ({
  useCan: () => (permission: string) => state.permissions.includes(permission),
}))

function pendingRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 4,
    reason: 'Raised this task and asked to work on it.',
    created_at: '2026-08-17T09:00:00Z',
    requester: { id: 7, first_name: 'Rico', last_name: 'Santos' },
    task: { id: 12, title: 'Re-cut the trailer audio', project: { id: 3, name: 'Launch reel' } },
    ...overrides,
  }
}

function renderInbox() {
  return render(
    <MemoryRouter>
      <WorkRequestInbox />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  state.permissions = ['tasks.review_work_requests']
  state.pending = [pendingRequest()]
  apiGet.mockClear()
  apiPost.mockClear()
})

it('names who is waiting and on what', async () => {
  renderInbox()

  expect(await screen.findByText('Rico Santos')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Re-cut the trailer audio' })).toBeInTheDocument()
  expect(screen.getByText(/Launch reel/)).toBeInTheDocument()
})

it('stays off the screen entirely when nobody is waiting', async () => {
  state.pending = []
  const { container } = renderInbox()

  await waitFor(() => expect(apiGet).toHaveBeenCalled())
  expect(container).toBeEmptyDOMElement()
})

it('never appears for somebody who cannot decide, and does not even ask', () => {
  state.permissions = []
  const { container } = renderInbox()

  expect(container).toBeEmptyDOMElement()
  expect(apiGet).not.toHaveBeenCalled()
})

it('approves in one click', async () => {
  renderInbox()
  await userEvent.click(await screen.findByRole('button', { name: 'Approve' }))

  expect(apiPost).toHaveBeenCalledWith('/api/tasks/12/work-requests/4/approve', {})
})

it('will not send a decline without a reason', async () => {
  renderInbox()
  await userEvent.click(await screen.findByRole('button', { name: 'Decline' }))

  const confirm = screen.getByRole('button', { name: 'Confirm decline' })
  expect(confirm).toBeDisabled()

  await userEvent.type(screen.getByRole('textbox'), 'Finish the launch reel first.')
  await userEvent.click(confirm)

  expect(apiPost).toHaveBeenCalledWith('/api/tasks/12/work-requests/4/decline', {
    reason: 'Finish the launch reel first.',
  })
})
