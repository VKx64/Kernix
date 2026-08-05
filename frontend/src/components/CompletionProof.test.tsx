import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { CompletionProofCard, CompletionProofModal } from './CompletionProof'
import type { CompletionProof } from '../types/api'

function renderModal(overrides: Partial<ComponentProps<typeof CompletionProofModal>> = {}) {
  const onSubmit = vi.fn()
  const props: ComponentProps<typeof CompletionProofModal> = {
    open: true,
    busy: false,
    taskTitle: 'Colour grade the trailer',
    onClose: vi.fn(),
    onSubmit,
    ...overrides,
  }

  return { ...render(<CompletionProofModal {...props} />), onSubmit }
}

function renderCard(proof: Partial<CompletionProof> = {}, overrides: Partial<ComponentProps<typeof CompletionProofCard>> = {}) {
  const onSettle = vi.fn()
  const props: ComponentProps<typeof CompletionProofCard> = {
    proof: {
      id: 4,
      summary: 'Graded the trailer and exported the master.',
      status: 'pending',
      ai_state: 'queued',
      submitted_by: { id: 2, first_name: 'Casey', last_name: 'Worker' },
      ...proof,
    } as CompletionProof,
    canReview: false,
    busy: false,
    onSettle,
    ...overrides,
  }

  return { ...render(<CompletionProofCard {...props} />), onSettle }
}

describe('CompletionProofModal', () => {
  it('refuses to submit without a real summary and at least one file', async () => {
    const actor = userEvent.setup()
    const { onSubmit } = renderModal()

    await actor.click(screen.getByRole('button', { name: 'Submit proof' }))
    expect(screen.getByRole('alert')).toHaveTextContent('a little more detail')
    expect(onSubmit).not.toHaveBeenCalled()

    await actor.type(screen.getByLabelText(/^What did you complete/), 'Graded the trailer and exported the 4K master.')
    await actor.click(screen.getByRole('button', { name: 'Submit proof' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Attach at least one file')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('hands the summary and files to the submit handler', async () => {
    const actor = userEvent.setup()
    const { onSubmit } = renderModal()
    const evidence = new File(['frame'], 'master-frame.png', { type: 'image/png' })

    await actor.type(screen.getByLabelText(/^What did you complete/), 'Graded the trailer and exported the 4K master.')
    await actor.upload(screen.getByLabelText('Attach proof files'), evidence)
    expect(screen.getByText('master-frame.png')).toBeInTheDocument()

    await actor.click(screen.getByRole('button', { name: 'Submit proof' }))
    expect(onSubmit).toHaveBeenCalledWith('Graded the trailer and exported the 4K master.', [evidence])
  })
})

describe('CompletionProofCard', () => {
  it('shows the audit verdict and what is still missing', () => {
    renderCard({
      status: 'rejected',
      ai_verdict: 'insufficient',
      ai_message: 'The screenshot does not show a graded master.',
      ai_missing_evidence: ['A frame from the exported master'],
      review_mode: 'ai',
    })

    expect(screen.getByText('Completion proof not accepted')).toBeInTheDocument()
    expect(screen.getByText('The screenshot does not show a graded master.')).toBeInTheDocument()
    expect(screen.getByText('A frame from the exported master')).toBeInTheDocument()
  })

  it('keeps review controls for reviewers only, and rejection needs a reason', async () => {
    const actor = userEvent.setup()
    const view = renderCard({ awaits_human_review: true, ai_state: 'failed' })
    expect(screen.queryByRole('button', { name: 'Approve completion' })).not.toBeInTheDocument()
    view.unmount()

    const { onSettle } = renderCard({ awaits_human_review: true, ai_state: 'failed' }, { canReview: true })
    expect(screen.getByText('Waiting on a reviewer')).toBeInTheDocument()

    await actor.click(screen.getByRole('button', { name: 'Reject' }))
    const confirm = screen.getByRole('button', { name: 'Confirm rejection' })
    expect(confirm).toBeDisabled()

    await actor.type(screen.getByLabelText('Why is this not accepted?'), 'The master is the ungraded cut.')
    await actor.click(confirm)
    expect(onSettle).toHaveBeenCalledWith(false, 'The master is the ungraded cut.')
  })

  it('approves without asking for a reason', async () => {
    const actor = userEvent.setup()
    const { onSettle } = renderCard({}, { canReview: true })

    await actor.click(screen.getByRole('button', { name: 'Approve completion' }))
    expect(onSettle).toHaveBeenCalledWith(true, '')
  })

  it('offers a resubmission after a rejection', async () => {
    const actor = userEvent.setup()
    const onResubmit = vi.fn()
    renderCard({ status: 'rejected' }, { onResubmit })

    await actor.click(screen.getByRole('button', { name: 'Submit new proof' }))
    expect(onResubmit).toHaveBeenCalled()
  })
})
