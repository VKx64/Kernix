import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { ProjectOnboarding } from './ProjectOnboarding'
import type { Client, FieldValue, Project, UserSummary } from '../types/api'

const clients: Client[] = [{ id: 7, name: 'Acme' }]
const managers: UserSummary[] = [{ id: 9, first_name: 'Casey', last_name: 'Worker' }]
const statuses: FieldValue[] = [{ id: 12, label: 'Planning', color: '#9c6cff' }]

function renderOnboarding(overrides: Partial<ComponentProps<typeof ProjectOnboarding>> = {}) {
  const onCreate = vi.fn(async () => ({ id: 44, name: 'Launch campaign', client: clients[0], manager: managers[0] }) as Project)
  const props: ComponentProps<typeof ProjectOnboarding> = {
    clients,
    managers,
    statuses,
    singleClientMode: false,
    busy: false,
    error: '',
    onClose: vi.fn(),
    onCreate,
    ...overrides,
  }
  return { ...render(<ProjectOnboarding {...props} />), props, onCreate }
}

async function completeBasics(actor: ReturnType<typeof userEvent.setup>) {
  await actor.type(screen.getByLabelText(/^Project name/), 'Launch campaign')
  await actor.selectOptions(screen.getByLabelText(/^Client/), '7')
  await actor.type(screen.getByLabelText(/^Short description/), 'Launch the campaign.')
  await actor.click(screen.getByRole('button', { name: 'Continue to plan' }))
}

describe('ProjectOnboarding', () => {
  it('guides the user through basics and plan validation while preserving the draft', async () => {
    const actor = userEvent.setup()
    renderOnboarding()

    expect(screen.getByRole('dialog', { name: 'Set up a project' })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Project setup progress' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Give the work a clear home' })).toBeInTheDocument()

    await actor.click(screen.getByRole('button', { name: 'Continue to plan' }))
    expect(screen.getByText('Enter a project name.')).toBeInTheDocument()
    expect(screen.getByText('Choose the client that owns this project.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Give the work a clear home' })).toBeInTheDocument()

    await completeBasics(actor)
    expect(screen.getByRole('heading', { name: 'Set the team up to deliver' })).toBeInTheDocument()

    await actor.type(screen.getByLabelText(/^Start date/), '2026-08-20')
    await actor.type(screen.getByLabelText(/^Due date/), '2026-08-10')
    await actor.click(screen.getByRole('button', { name: 'Review project' }))
    expect(screen.getByText('Due date must be on or after the start date.')).toBeInTheDocument()

    await actor.clear(screen.getByLabelText(/^Due date/))
    await actor.type(screen.getByLabelText(/^Due date/), '2026-08-31')
    await actor.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByDisplayValue('Launch campaign')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Acme')).toBeInTheDocument()
  })

  it('reviews the complete payload, creates the project, and offers the next task action', async () => {
    const actor = userEvent.setup()
    const onOpenTasks = vi.fn()
    const { onCreate } = renderOnboarding({ canOpenTasks: true, onOpenTasks })

    await completeBasics(actor)
    await actor.selectOptions(screen.getByLabelText(/^Project manager/), '9')
    await actor.selectOptions(screen.getByLabelText(/^Starting status/), '12')
    await actor.type(screen.getByLabelText(/^Start date/), '2026-08-01')
    await actor.type(screen.getByLabelText(/^Due date/), '2026-08-31')
    await actor.click(screen.getByRole('button', { name: 'Review project' }))

    expect(screen.getByRole('heading', { name: 'One last look' })).toBeInTheDocument()
    expect(screen.getByText('Acme')).toBeInTheDocument()
    expect(screen.getByText('Casey Worker')).toBeInTheDocument()
    expect(screen.getByText('Planning')).toBeInTheDocument()
    expect(screen.getByText('Launch the campaign.')).toBeInTheDocument()

    await actor.click(screen.getByRole('button', { name: 'Create project' }))
    expect(onCreate).toHaveBeenCalledWith({
      name: 'Launch campaign',
      client_id: '7',
      manager_user_id: '9',
      status_value_id: '12',
      start_date: '2026-08-01',
      due_date: '2026-08-31',
      description: 'Launch the campaign.',
    })

    expect(await screen.findByRole('heading', { name: 'Launch campaign is ready for the team' })).toBeInTheDocument()
    await actor.click(screen.getByRole('button', { name: 'Open project tasks' }))
    expect(onOpenTasks).toHaveBeenCalledWith(expect.objectContaining({ id: 44, name: 'Launch campaign' }))
  })

  it('uses the configured client implicitly in single-client workspaces', async () => {
    const actor = userEvent.setup()
    const { onCreate } = renderOnboarding({ singleClientMode: true, singleClientId: 42, singleClient: { id: 42, name: 'Northwind' } })

    expect(screen.queryByLabelText(/^Client/)).not.toBeInTheDocument()
    expect(screen.getByText('Northwind')).toBeInTheDocument()
    await actor.type(screen.getByLabelText(/^Project name/), 'Retainer')
    await actor.click(screen.getByRole('button', { name: 'Continue to plan' }))
    await actor.click(screen.getByRole('button', { name: 'Review project' }))
    await actor.click(screen.getByRole('button', { name: 'Create project' }))

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Retainer', client_id: 42 }))
  })

  it('keeps lookup failures distinct from an empty client list and offers retry', async () => {
    const actor = userEvent.setup()
    const onRetryLookups = vi.fn()
    renderOnboarding({
      clients: [],
      lookupError: 'Some project setup options could not be loaded.',
      onRetryLookups,
    })

    expect(screen.getByLabelText(/^Project name/)).toBeRequired()
    expect(screen.getByLabelText(/^Client/)).toBeRequired()
    expect(screen.getByRole('alert')).toHaveTextContent('Some project setup options could not be loaded.')
    await actor.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetryLookups).toHaveBeenCalledOnce()
  })

  it('locks every review action while project creation is in progress', async () => {
    const actor = userEvent.setup()
    const view = renderOnboarding()

    await completeBasics(actor)
    await actor.click(screen.getByRole('button', { name: 'Review project' }))
    view.rerender(<ProjectOnboarding {...view.props} busy />)

    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit basics' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit plan' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled()
  })

  it('starts with the step context, exposes honest progress, and only enables completed steps', async () => {
    const actor = userEvent.setup()
    renderOnboarding()

    const heading = screen.getByRole('heading', { name: 'Give the work a clear home' })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(screen.getByRole('progressbar', { name: 'Project setup step' })).toHaveAttribute('aria-valuetext', 'Step 1 of 3: Basics')
    expect(screen.getByRole('button', { name: 'Basics, current step' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Plan, upcoming' })).toBeDisabled()

    await actor.tab()
    expect(screen.getByLabelText(/^Project name/)).toHaveFocus()
    await completeBasics(actor)
    expect(screen.getByRole('button', { name: 'Basics, complete' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Plan, current step' })).toBeDisabled()
    expect(screen.getByRole('progressbar', { name: 'Project setup step' })).toHaveAttribute('aria-valuetext', 'Step 2 of 3: Plan')
  })

  it('returns directly to review after editing a completed section', async () => {
    const actor = userEvent.setup()
    renderOnboarding()

    await completeBasics(actor)
    await actor.click(screen.getByRole('button', { name: 'Review project' }))
    await actor.click(screen.getByRole('button', { name: 'Edit basics' }))
    expect(screen.getByRole('button', { name: 'Back to review' })).toBeInTheDocument()
    await actor.clear(screen.getByLabelText(/^Project name/))
    await actor.type(screen.getByLabelText(/^Project name/), 'Launch campaign v2')
    await actor.click(screen.getByRole('button', { name: 'Back to review' }))

    expect(screen.getByRole('heading', { name: 'One last look' })).toBeInTheDocument()
    expect(screen.getByText('Launch campaign v2')).toBeInTheDocument()
  })

  it('turns an empty client workspace into a clear prerequisite action', async () => {
    const actor = userEvent.setup()
    const onOpenClients = vi.fn()
    renderOnboarding({ clients: [], canCreateClients: true, onOpenClients })

    expect(screen.queryByLabelText(/^Client/)).not.toBeInTheDocument()
    expect(screen.getByText('A client comes first')).toBeInTheDocument()
    await actor.click(screen.getByRole('button', { name: 'Add first client' }))
    expect(onOpenClients).toHaveBeenCalledOnce()
  })
})
