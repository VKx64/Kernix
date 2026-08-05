import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { CreateTaskModal } from './CreateTaskModal'

const projects = [{ id: 5, name: 'Launch campaign' }]
const folders = [{ id: 11, project_id: 5, name: 'Pre-production' }]
const users = [{ id: 9, first_name: 'Casey', last_name: 'Worker' }]
const statusOptions = [{ id: 21, label: 'In progress' }]
const typeOptions = [{ id: 31, label: 'Milestone' }]
const urgencyOptions = [{ id: 41, label: 'High' }]

function renderModal(overrides: Partial<ComponentProps<typeof CreateTaskModal>> = {}) {
  const onSubmit = vi.fn()
  const props: ComponentProps<typeof CreateTaskModal> = {
    open: true,
    busy: false,
    initialProjectId: '5',
    projects,
    folders,
    users,
    statusOptions,
    typeOptions,
    urgencyOptions,
    canAssign: true,
    canChangeStatus: true,
    canEstimate: true,
    canCreateSubtasks: true,
    onClose: vi.fn(),
    onSubmit,
    ...overrides,
  }

  return { ...render(<CreateTaskModal {...props} />), props, onSubmit }
}

type Actor = ReturnType<typeof userEvent.setup>

async function choose(actor: Actor, field: string, option: string) {
  await actor.click(screen.getByRole('combobox', { name: field }))
  const listbox = await screen.findByRole('listbox', { name: field })
  await actor.click(await within(listbox).findByRole('option', { name: option }))
  // Radix unmounts the listbox on close; waiting for that keeps the next
  // trigger click from landing on a still-closing popup underneath it.
  await waitFor(() => expect(screen.queryByRole('listbox', { name: field })).not.toBeInTheDocument())
}

/**
 * Clicks the Due date trigger, picks the first selectable (non-outside-month)
 * day in the open picker, and returns the ISO date the component should submit.
 */
async function pickDueDate(actor: Actor) {
  await actor.click(screen.getByRole('button', { name: 'Due date' }))
  const dialogs = await waitFor(() => {
    const found = screen.getAllByRole('dialog')
    if (found.length < 2) throw new Error('Date picker popover has not opened yet.')
    return found
  })
  const popover = dialogs[dialogs.length - 1]
  const dayButton = within(popover)
    .getAllByRole('button')
    .find((button) => button.dataset.day && !button.closest('td')?.className.includes('outside'))
  if (!dayButton) throw new Error('No selectable day found in the due date picker.')
  await actor.click(dayButton)
  await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1))
  const parsed = new Date(dayButton.dataset.day as string)
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`
}

/** Opens the "More details" section, once. */
async function openMore(actor: Actor) {
  await actor.click(screen.getByRole('button', { name: 'More details' }))
}

describe('CreateTaskModal', () => {
  it('focuses the title and keeps a compact property row of Project, Due, Assignee and Priority', async () => {
    const view = renderModal()

    await waitFor(() => expect(screen.getByLabelText('Task title')).toHaveFocus())
    expect(screen.getByLabelText('Project')).toBeInTheDocument()
    expect(screen.getByLabelText('Due date')).toBeInTheDocument()
    expect(screen.getByLabelText('Assignee')).toBeInTheDocument()
    expect(screen.getByLabelText('Priority')).toBeInTheDocument()
    expect(screen.queryByLabelText('Folder')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Type')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Status')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Description')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Estimated minutes')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Subtask 1 title')).not.toBeInTheDocument()

    view.rerender(<CreateTaskModal {...view.props} canAssign={false} canChangeStatus={false} />)
    expect(screen.queryByLabelText('Assignee')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Due date')).toBeInTheDocument()
    expect(screen.getByLabelText('Priority')).toBeInTheDocument()
  })

  it('lifts @assignee, !priority and a due date out of the title as it is typed', async () => {
    const actor = userEvent.setup()
    renderModal()

    await actor.type(screen.getByLabelText('Task title'), 'Ship copy tomorrow @casey !high')

    // The last token is still being typed, so it stays in the field until the
    // user moves on — otherwise a longer name could never be finished.
    expect(screen.getByLabelText('Task title')).toHaveValue('Ship copy !high')
    expect(screen.getByRole('combobox', { name: 'Assignee' })).toHaveTextContent('Casey Worker')

    await actor.tab()

    expect(screen.getByLabelText('Task title')).toHaveValue('Ship copy')
    expect(screen.getByRole('combobox', { name: 'Priority' })).toHaveTextContent('High')
  })

  it('leaves unmatched tokens in the title untouched', async () => {
    const actor = userEvent.setup()
    renderModal()

    await actor.type(screen.getByLabelText('Task title'), 'Ping @nobody about the deck')

    expect(screen.getByLabelText('Task title')).toHaveValue('Ping @nobody about the deck')
    expect(screen.getByRole('combobox', { name: 'Assignee' })).toHaveTextContent('Unassigned')
  })

  it('reveals Folder, Type and Status behind More details', async () => {
    const actor = userEvent.setup()
    renderModal()

    expect(screen.queryByLabelText('Folder')).not.toBeInTheDocument()
    await openMore(actor)

    expect(screen.getByLabelText('Folder')).toBeInTheDocument()
    expect(screen.getByLabelText('Type')).toBeInTheDocument()
    expect(screen.getByLabelText('Status')).toBeInTheDocument()
    expect(screen.getByLabelText('Description')).toBeInTheDocument()
  })

  it('reveals subtasks from More details and Enter adds a stable row without submitting', async () => {
    const actor = userEvent.setup()
    const { onSubmit } = renderModal()

    await openMore(actor)
    expect(screen.getByRole('button', { name: 'Time estimate' })).toBeInTheDocument()
    await actor.click(screen.getByRole('button', { name: 'Subtasks' }))

    const firstSubtask = screen.getByLabelText('Subtask 1 title')
    await actor.type(firstSubtask, 'Draft the brief{Enter}')

    expect(await screen.findByLabelText('Subtask 2 title')).toBeInTheDocument()
    expect(firstSubtask).toHaveValue('Draft the brief')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits trimmed nested subtasks together with selected supported properties', async () => {
    const actor = userEvent.setup()
    const { onSubmit } = renderModal()

    await actor.type(screen.getByLabelText('Task title'), '  Ship campaign  ')
    await choose(actor, 'Assignee', 'Casey Worker')
    const due = await pickDueDate(actor)
    await choose(actor, 'Priority', 'High')

    await openMore(actor)
    await actor.type(screen.getByLabelText('Description'), '  Helpful context  ')
    await choose(actor, 'Folder', 'Pre-production')
    await choose(actor, 'Type', 'Milestone')
    await choose(actor, 'Status', 'In progress')

    await actor.click(screen.getByRole('button', { name: 'Time estimate' }))
    await actor.type(screen.getByLabelText('Estimated minutes'), '90')
    await actor.click(screen.getByRole('button', { name: 'Subtasks' }))

    await actor.type(screen.getByLabelText('Subtask 1 title'), '  Draft brief  {Enter}')
    await actor.type(await screen.findByLabelText('Subtask 2 title'), '  Review copy  ')
    await actor.click(screen.getByRole('button', { name: 'Add subtask' }))
    await actor.click(screen.getByRole('button', { name: 'Create task' }))

    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onSubmit).toHaveBeenCalledWith({
      project_id: '5',
      title: 'Ship campaign',
      task_folder_id: '11',
      status_value_id: '21',
      type_value_id: '31',
      urgency_value_id: '41',
      assignee_user_id: '9',
      due_date: due,
      description: 'Helpful context',
      estimated_minutes: 90,
      subtasks: [{ title: 'Draft brief' }, { title: 'Review copy' }],
    }, [])
  })

  it('does not expose More details options the user lacks permission to add', async () => {
    const actor = userEvent.setup()
    renderModal({ canEstimate: false, canCreateSubtasks: false })

    await openMore(actor)
    expect(screen.queryByRole('button', { name: 'Time estimate' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Subtasks' })).not.toBeInTheDocument()
  })

  it('uses configured default labels without duplicating their options', async () => {
    const actor = userEvent.setup()
    renderModal({
      statusOptions: [{ id: 20, key: 'pending', label: 'Ready' }, { id: 21, label: 'In progress' }],
      typeOptions: [{ id: 30, key: 'task', label: 'Work item' }, { id: 31, label: 'Milestone' }],
      urgencyOptions: [{ id: 40, key: 'normal', label: 'Standard' }, { id: 41, label: 'High' }],
    })

    expect(screen.getByRole('combobox', { name: 'Priority' })).toHaveTextContent('Standard')
    await openMore(actor)
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveTextContent('Ready')
    expect(screen.getByRole('combobox', { name: 'Type' })).toHaveTextContent('Work item')

    for (const [field, label] of [['Status', 'Ready'], ['Type', 'Work item'], ['Priority', 'Standard']]) {
      await actor.click(screen.getByRole('combobox', { name: field }))
      const menu = await screen.findByRole('listbox', { name: field })
      expect(within(menu).getAllByRole('option', { name: label })).toHaveLength(1)
      await actor.keyboard('{Escape}')
      // Radix removes the listbox from the accessibility tree only once its
      // dismissal effects finish; waiting here keeps the next trigger click
      // from landing while the previous popup is still tearing down.
      await waitFor(() => expect(screen.queryByRole('listbox', { name: field })).not.toBeInTheDocument())
    }
  })

  it('undoes an optional choice from the same control', async () => {
    const actor = userEvent.setup()
    renderModal()

    await choose(actor, 'Assignee', 'Casey Worker')
    expect(screen.getByRole('combobox', { name: 'Assignee' })).toHaveTextContent('Casey Worker')

    await choose(actor, 'Assignee', 'Unassigned')
    expect(screen.getByRole('combobox', { name: 'Assignee' })).toHaveTextContent('Unassigned')
  })

  it('stages files for upload and hands them to the submit handler', async () => {
    const actor = userEvent.setup()
    const { onSubmit } = renderModal({ canAttach: true })

    await openMore(actor)
    await actor.click(screen.getByRole('button', { name: 'Attachments' }))

    const storyboard = new File(['frame'], 'storyboard.png', { type: 'image/png' })
    await actor.upload(screen.getByLabelText('Attach files'), storyboard)
    expect(screen.getByText('storyboard.png')).toBeInTheDocument()

    await actor.upload(screen.getByLabelText('Attach files'), new File(['x'], 'clip.mp4', { type: 'video/mp4' }))
    await actor.click(screen.getByRole('button', { name: 'Remove clip.mp4' }))
    expect(screen.queryByText('clip.mp4')).not.toBeInTheDocument()

    await actor.type(screen.getByLabelText('Task title'), 'Ship campaign')
    await actor.click(screen.getByRole('button', { name: 'Create task' }))

    expect(onSubmit).toHaveBeenCalledWith({ project_id: '5', title: 'Ship campaign' }, [storyboard])
  })

  it('refuses executable attachments before they reach the API', async () => {
    const actor = userEvent.setup()
    renderModal({ canAttach: true })

    await openMore(actor)
    await actor.click(screen.getByRole('button', { name: 'Attachments' }))
    await actor.upload(screen.getByLabelText('Attach files'), new File(['<?php'], 'payload.php', { type: 'text/x-php' }))

    expect(screen.getByRole('alert')).toHaveTextContent('payload.php is an executable or script file.')
    expect(screen.queryByText('payload.php')).not.toBeInTheDocument()
  })

  it('hides attachments entirely without the permission', async () => {
    const actor = userEvent.setup()
    renderModal({ canAttach: false })

    await openMore(actor)
    expect(screen.queryByRole('button', { name: 'Attachments' })).not.toBeInTheDocument()
  })

  it('stops inline drafting at the backend subtask limit', async () => {
    const actor = userEvent.setup()
    renderModal()

    await openMore(actor)
    await actor.click(screen.getByRole('button', { name: 'Subtasks' }))
    const add = screen.getByRole('button', { name: 'Add subtask' })
    for (let index = 1; index < 50; index += 1) fireEvent.click(add)

    const last = screen.getByLabelText('Subtask 50 title')
    expect(add).toBeDisabled()
    fireEvent.change(last, { target: { value: 'Final step' } })
    fireEvent.keyDown(last, { key: 'Enter' })
    expect(screen.queryByLabelText('Subtask 51 title')).not.toBeInTheDocument()
    expect(screen.getByText('50-subtask limit reached.')).toBeInTheDocument()
  })
})
