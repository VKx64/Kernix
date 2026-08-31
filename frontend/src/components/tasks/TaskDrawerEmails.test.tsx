import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskDrawerEmails } from './TaskDrawerEmails'
import type { Note } from '../../types/api'

const apiPost = vi.hoisted(() => vi.fn(async () => ({ data: {} })))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, post: apiPost } }
})

function email(id: number, overrides: Record<string, unknown> = {}): Note {
  return {
    id,
    body: 'The revised schedule is attached.',
    subject: 'Schedule',
    to_addresses: 'client@example.com',
    sent_at: '2026-08-20T09:00:00Z',
    status: 'sent',
    ...overrides,
  } as unknown as Note
}

function renderEmails(emails: Note[], overrides: Partial<Parameters<typeof TaskDrawerEmails>[0]> = {}) {
  return render(
    <TaskDrawerEmails
      taskId={48}
      emails={emails}
      canManage={false}
      onChanged={() => {}}
      {...overrides}
    />,
  )
}

describe('TaskDrawerEmails', () => {
  beforeEach(() => apiPost.mockClear())

  it('stays absent when there is no correspondence and the viewer may not write any', () => {
    const { container } = renderEmails([])

    expect(container).toBeEmptyDOMElement()
  })

  it('shows captured correspondence to a reader who may not send', () => {
    renderEmails([email(1)])

    expect(screen.getByText('Schedule')).toBeInTheDocument()
    expect(screen.getByText('To: client@example.com')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Write' })).not.toBeInTheDocument()
  })

  it('sends what was composed and clears the form', async () => {
    const onChanged = vi.fn()
    renderEmails([], { canManage: true, onChanged })

    await userEvent.click(screen.getByRole('button', { name: 'Write' }))
    await userEvent.type(screen.getByLabelText('To'), 'client@example.com')
    await userEvent.type(screen.getByLabelText('Subject'), 'Schedule')
    await userEvent.type(screen.getByLabelText('Message'), 'Revised dates inside.')
    await userEvent.click(screen.getByRole('button', { name: 'Send email' }))

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/tasks/48/emails', {
      to_addresses: 'client@example.com',
      subject: 'Schedule',
      body: 'Revised dates inside.',
      admin_override: undefined,
    }))
    expect(onChanged).toHaveBeenCalled()
    expect(screen.queryByLabelText('To')).not.toBeInTheDocument()
  })

  it('refuses to send until all three fields are filled', async () => {
    renderEmails([], { canManage: true })

    await userEvent.click(screen.getByRole('button', { name: 'Write' }))
    await userEvent.type(screen.getByLabelText('To'), 'client@example.com')

    expect(screen.getByRole('button', { name: 'Send email' })).toBeDisabled()
  })

  it('reads an archived task without offering to write to it', () => {
    renderEmails([email(1)], { canManage: true, readOnly: true })

    expect(screen.getByText('Schedule')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Write' })).not.toBeInTheDocument()
  })
})
