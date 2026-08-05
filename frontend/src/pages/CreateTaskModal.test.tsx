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

describe('CreateTaskModal', () => {
  it('focuses the title and keeps permitted core properties compact', async () => {
    const view = renderModal()

    await waitFor(() => expect(screen.getByLabelText('Task title')).toHaveFocus())
    expect(screen.getByLabelText('Project')).toBeInTheDocument()
    expect(screen.getByLabelText('Folder')).toBeInTheDocument()
    expect(screen.getByLabelText('Type')).toBeInTheDocument()
    expect(screen.getByLabelText('Status')).toBeInTheDocument()
    expect(screen.getByLabelText('Assignee')).toBeInTheDocument()
    expect(screen.getByLabelText('Due date')).toBeInTheDocument()
    expect(screen.getByLabelText('Priority')).toBeInTheDocument()
    expect(screen.queryByLabelText('Estimated minutes')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Subtask 1 title')).not.toBeInTheDocument()

    view.rerender(<CreateTaskModal {...view.props} canAssign={false} canChangeStatus={false} />)
    expect(screen.queryByLabelText('Status')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Assignee')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Due date')).toBeInTheDocument()
    expect(screen.getByLabelText('Priority')).toBeInTheDocument()
  })

  it('reveals subtasks from More and Enter adds a stable row without submitting', async () => {
    const actor = userEvent.setup()
    const { onSubmit } = renderModal()

    await actor.click(screen.getByLabelText('More task properties'))
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
    await actor.type(screen.getByLabelText('Description'), '  Helpful context  ')
    await choose(actor, 'Folder', 'Pre-production')
    await choose(actor, 'Type', 'Milestone')
    await choose(actor, 'Status', 'In progress')
    await choose(actor, 'Assignee', 'Casey Worker')
    const due = await pickDay(actor, 'Due date', 18)
    await choose(actor, 'Priority', 'High')

    await actor.click(screen.getByLabelText('More task properties'))
    await actor.click(screen.getByRole('button', { name: 'Time estimate' }))
    await actor.type(screen.getByLabelText('Estimated minutes'), '90')
    await actor.click(screen.getByLabelText('More task properties'))
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

  it('does not expose More options the user lacks permission to add', () => {
    renderModal({ canEstimate: false, canCreateSubtasks: false })

    expect(screen.queryByLabelText('More task properties')).not.toBeInTheDocument()
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

    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveTextContent('Ready')
    expect(screen.getByRole('combobox', { name: 'Type' })).toHaveTextContent('Work item')
    expect(screen.getByRole('combobox', { name: 'Priority' })).toHaveTextContent('Standard')

    for (const [field, label] of [['Status', 'Ready'], ['Type', 'Work item'], ['Priority', 'Standard']]) {
      await actor.click(screen.getByRole('combobox', { name: field }))
      const menu = await screen.findByRole('listbox', { name: field })
      expect(within(menu).getAllByRole('option', { name: label })).toHaveLength(1)
      await actor.keyboard('{Escape}')
    }
  })

  it('undoes an optional choice from the same menu', async () => {
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

    await actor.click(screen.getByLabelText('More task properties'))
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

    await actor.click(screen.getByLabelText('More task properties'))
    await actor.click(screen.getByRole('button', { name: 'Attachments' }))
    await actor.upload(screen.getByLabelText('Attach files'), new File(['<?php'], 'payload.php', { type: 'text/x-php' }))

    expect(screen.getByRole('alert')).toHaveTextContent('payload.php is an executable or script file.')
    expect(screen.queryByText('payload.php')).not.toBeInTheDocument()
  })

  it('hides attachments entirely without the permission', async () => {
    const actor = userEvent.setup()
    renderModal({ canAttach: false })

    await actor.click(screen.getByLabelText('More task properties'))
    expect(screen.queryByRole('button', { name: 'Attachments' })).not.toBeInTheDocument()
  })

  it('stops inline drafting at the backend subtask limit', async () => {
    const actor = userEvent.setup()
    renderModal()

    await actor.click(screen.getByLabelText('More task properties'))
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
