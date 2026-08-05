import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { ProjectOnboarding } from './ProjectOnboarding'
import type { Client, FieldValue, Project, UserSummary } from '../types/api'

const clients: Client[] = [{ id: 7, name: 'Acme' }]
const managers: UserSummary[] = [{ id: 9, first_name: 'Casey', last_name: 'Worker' }]
const statuses: FieldValue[] = [{ id: 12, label: 'Planning', color: '#9c6cff' }]

type Actor = ReturnType<typeof userEvent.setup>

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

async function choose(actor: Actor, field: string, option: string) {
  await actor.click(screen.getByRole('combobox', { name: field }))
  await actor.click(await screen.findByRole('option', { name: option }))
}

/** Clicks a selectable day in whichever month the picker opens on, returning its ISO value. */
async function pickDay(actor: Actor, field: string, day: number) {
  await actor.click(screen.getByRole('button', { name: field }))
  const popup = await screen.findByRole('dialog', { name: field })
  const cell = within(popup)
    .getAllByRole('button')
    .find((button) => button.dataset.day && !button.className.includes('is-outside') && button.textContent === String(day))
  if (!cell) throw new Error(`No selectable day ${day} in the ${field} picker.`)
  await actor.click(cell)
  return cell.dataset.day as string
}

describe('ProjectOnboarding', () => {
  it('opens as a single composer focused on the project name', async () => {
    renderOnboarding()

    expect(screen.getByRole('dialog', { name: 'New project' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText(/^Project name/)).toHaveFocus())
    expect(screen.getByRole('button', { name: 'Create project' })).toBeEnabled()
  })

  it('blocks submission until the required name and client are set, keeping the draft intact', async () => {
    const actor = userEvent.setup()
    const { onCreate } = renderOnboarding()

    await actor.click(screen.getByRole('button', { name: 'Create project' }))
    expect(onCreate).not.toHaveBeenCalled()
    expect(screen.getByText('Enter a project name.')).toBeInTheDocument()
    expect(screen.getByText('Choose the client that owns this project.')).toBeInTheDocument()

    await actor.type(screen.getByLabelText(/^Project name/), 'Launch campaign')
    await actor.type(screen.getByLabelText(/^Description/), 'Launch the campaign.')
    await actor.click(screen.getByRole('button', { name: 'Create project' }))
    expect(onCreate).not.toHaveBeenCalled()
    expect(screen.getByDisplayValue('Launch campaign')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Launch the campaign.')).toBeInTheDocument()
    expect(screen.queryByText('Enter a project name.')).not.toBeInTheDocument()
  })

  it('marks the client select required and reflects the chosen option', async () => {
    const actor = userEvent.setup()
    renderOnboarding()

    const client = screen.getByRole('combobox', { name: 'Client' })
    expect(client).toBeRequired()
    expect(client).toHaveTextContent('Select a client…')

    await choose(actor, 'Client', 'Acme')
    expect(client).toHaveTextContent('Acme')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('stops a due date from being picked before the start date', async () => {
    const actor = userEvent.setup()
    renderOnboarding()

    const start = await pickDay(actor, 'Start date', 20)

    await actor.click(screen.getByRole('button', { name: 'Due date' }))
    const popup = await screen.findByRole('dialog', { name: 'Due date' })
    const earlier = within(popup).getAllByRole('button').find((button) => button.dataset.day && button.dataset.day < start)
    expect(earlier).toBeDisabled()
  })

  it('creates the project from one pass and offers the next task action', async () => {
    const actor = userEvent.setup()
    const onOpenTasks = vi.fn()
    const { onCreate } = renderOnboarding({ canOpenTasks: true, onOpenTasks })

    await actor.type(screen.getByLabelText(/^Project name/), 'Launch campaign')
    await choose(actor, 'Client', 'Acme')
    await actor.type(screen.getByLabelText(/^Description/), 'Launch the campaign.')
    await choose(actor, 'Project manager', 'Casey Worker')
    await choose(actor, 'Starting status', 'Planning')
    const start = await pickDay(actor, 'Start date', 10)
    const due = await pickDay(actor, 'Due date', 20)

    await actor.click(screen.getByRole('button', { name: 'Create project' }))

    expect(onCreate).toHaveBeenCalledWith({
      name: 'Launch campaign',
      client_id: '7',
      manager_user_id: '9',
      status_value_id: '12',
      start_date: start,
      due_date: due,
      description: 'Launch the campaign.',
    })

    expect(await screen.findByRole('heading', { name: 'Launch campaign' })).toBeInTheDocument()
    expect(screen.getByText('Acme')).toBeInTheDocument()
    expect(screen.getByText('Casey Worker')).toBeInTheDocument()

    await actor.click(screen.getByRole('button', { name: 'Open project tasks' }))
    expect(onOpenTasks).toHaveBeenCalledWith(expect.objectContaining({ id: 44, name: 'Launch campaign' }))
  })

  it('lets an optional select be returned to its unset state', async () => {
    const actor = userEvent.setup()
    renderOnboarding()

    await choose(actor, 'Project manager', 'Casey Worker')
    expect(screen.getByRole('combobox', { name: 'Project manager' })).toHaveTextContent('Casey Worker')

    await choose(actor, 'Project manager', 'Unassigned')
    expect(screen.getByRole('combobox', { name: 'Project manager' })).toHaveTextContent('Unassigned')
  })

  it('uses the configured client implicitly in single-client workspaces', async () => {
    const actor = userEvent.setup()
    const { onCreate } = renderOnboarding({ singleClientMode: true, singleClientId: 42, singleClient: { id: 42, name: 'Northwind' } })

    expect(screen.queryByRole('combobox', { name: 'Client' })).not.toBeInTheDocument()
    expect(screen.getByText('Northwind')).toBeInTheDocument()

    await actor.type(screen.getByLabelText(/^Project name/), 'Retainer')
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
    expect(screen.getByRole('combobox', { name: 'Client' })).toBeRequired()
    expect(screen.getByRole('alert')).toHaveTextContent('Some project setup options could not be loaded.')

    await actor.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetryLookups).toHaveBeenCalledOnce()
  })

  it('locks every action while project creation is in progress', async () => {
    const actor = userEvent.setup()
    const view = renderOnboarding()

    await actor.type(screen.getByLabelText(/^Project name/), 'Launch campaign')
    await choose(actor, 'Client', 'Acme')
    view.rerender(<ProjectOnboarding {...view.props} busy />)

    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled()
    expect(screen.getByLabelText(/^Project name/)).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Client' })).toBeDisabled()
  })

  it('turns an empty client workspace into a clear prerequisite action', async () => {
    const actor = userEvent.setup()
    const onOpenClients = vi.fn()
    renderOnboarding({ clients: [], canCreateClients: true, onOpenClients })

    expect(screen.queryByLabelText(/^Project name/)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'A client comes first' })).toBeInTheDocument()

    await actor.click(screen.getByRole('button', { name: 'Add first client' }))
    expect(onOpenClients).toHaveBeenCalledOnce()
  })
})
