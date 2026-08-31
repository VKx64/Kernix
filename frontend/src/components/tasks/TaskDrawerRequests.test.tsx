import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskDrawerRequests } from './TaskDrawerRequests'
import type { EstimateRequest, TaskWorkRequest } from '../../types/api'

const apiPost = vi.hoisted(() => vi.fn(async () => ({ data: {} })))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, post: apiPost } }
})

function workRequest(overrides: Partial<TaskWorkRequest> = {}): TaskWorkRequest {
  return {
    id: 7,
    reason: 'I wrote the original importer and can finish this today.',
    status: 'pending',
    requester: { id: 5, first_name: 'Gem', last_name: 'Cornillez' },
    ...overrides,
  } as TaskWorkRequest
}

function renderRequests(overrides: Partial<Parameters<typeof TaskDrawerRequests>[0]> = {}) {
  return render(
    <TaskDrawerRequests
      taskId={48}
      estimateRequests={[]}
      workRequests={[]}
      canRequestEstimate={false}
      canReviewWork={false}
      onChanged={() => {}}
      {...overrides}
    />,
  )
}

describe('TaskDrawerRequests', () => {
  beforeEach(() => apiPost.mockClear())

  it('stays absent when there is nothing to ask and nothing to answer', () => {
    const { container } = renderRequests()

    expect(container).toBeEmptyDOMElement()
  })

  it('sends an estimate request with its minutes and reason', async () => {
    const onChanged = vi.fn()
    renderRequests({ canRequestEstimate: true, onChanged })

    await userEvent.click(screen.getByRole('button', { name: 'Request more time' }))
    const minutes = screen.getByLabelText('Additional minutes')
    await userEvent.clear(minutes)
    await userEvent.type(minutes, '45')
    await userEvent.type(screen.getByLabelText('Why more time is needed'), 'The import needs a second pass.')
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }))

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/tasks/48/estimate-requests', {
      additional_minutes: 45,
      reason: 'The import needs a second pass.',
      admin_override: undefined,
    }))
    expect(onChanged).toHaveBeenCalled()
  })

  it('shows the standing estimate request and its verdict', () => {
    const request = { id: 2, status: 'approved', requested_additional_minutes: 90, request_reason: 'Scope grew.' } as EstimateRequest
    renderRequests({ estimateRequests: [request] })

    expect(screen.getByText('1h 30m additional')).toBeInTheDocument()
    expect(screen.getByText('approved')).toBeInTheDocument()
    expect(screen.getByText('Scope grew.')).toBeInTheDocument()
  })

  it('approves a pending work request for a reviewer', async () => {
    renderRequests({ canReviewWork: true, workRequests: [workRequest()] })

    expect(screen.getByText('Gem Cornillez')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/tasks/48/work-requests/7/approve', {}))
  })

  it('will not decline a work request without a reason', async () => {
    renderRequests({ canReviewWork: true, workRequests: [workRequest()] })

    await userEvent.click(screen.getByRole('button', { name: 'Decline' }))
    expect(screen.getByRole('button', { name: 'Confirm decline' })).toBeDisabled()

    await userEvent.type(screen.getByLabelText('Why this is declined'), 'Already staffed.')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm decline' }))

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/tasks/48/work-requests/7/decline', { reason: 'Already staffed.' }))
  })

  it('lets the requester withdraw their own pending request', async () => {
    renderRequests({ currentUserId: 5, workRequests: [workRequest()] })

    await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }))

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/tasks/48/work-requests/7/withdraw'))
  })

  it('offers no decision to somebody who may not review', () => {
    renderRequests({ workRequests: [workRequest()] })

    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })
})
