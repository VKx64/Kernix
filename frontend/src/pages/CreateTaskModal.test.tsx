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
    await actor.selectOptions(screen.getByLabelText('Folder'), '11')
    await actor.selectOptions(screen.getByLabelText('Type'), '31')
    await actor.selectOptions(screen.getByLabelText('Status'), '21')
    await actor.selectOptions(screen.getByLabelText('Assignee'), '9')
    await actor.type(screen.getByLabelText('Due date'), '2026-08-31')
    await actor.selectOptions(screen.getByLabelText('Priority'), '41')

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
      due_date: '2026-08-31',
      description: 'Helpful context',
      estimated_minutes: 90,
      subtasks: [{ title: 'Draft brief' }, { title: 'Review copy' }],
    })
  })

  it('does not expose More options the user lacks permission to add', () => {
    renderModal({ canEstimate: false, canCreateSubtasks: false })

    expect(screen.queryByLabelText('More task properties')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Time estimate' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Subtasks' })).not.toBeInTheDocument()
  })

  it('uses configured default labels without duplicating their options', () => {
    renderModal({
      statusOptions: [{ id: 20, key: 'pending', label: 'Ready' }, { id: 21, label: 'In progress' }],
      typeOptions: [{ id: 30, key: 'task', label: 'Work item' }, { id: 31, label: 'Milestone' }],
      urgencyOptions: [{ id: 40, key: 'normal', label: 'Standard' }, { id: 41, label: 'High' }],
    })

    const status = screen.getByLabelText('Status')
    const type = screen.getByLabelText('Type')
    const priority = screen.getByLabelText('Priority')
    expect(status).toHaveDisplayValue('Ready')
    expect(type).toHaveDisplayValue('Work item')
    expect(priority).toHaveDisplayValue('Standard')
    expect(within(status).getAllByRole('option', { name: 'Ready' })).toHaveLength(1)
    expect(within(type).getAllByRole('option', { name: 'Work item' })).toHaveLength(1)
    expect(within(priority).getAllByRole('option', { name: 'Standard' })).toHaveLength(1)
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
