import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { CreateTaskModal } from './CreateTaskModal'

/**
 * Quick capture, against "UI Spec — New Task Modal" rev 1.0.
 *
 * The cases below are the acceptance checklist from section 11, plus the
 * capabilities this product has that the spec's prototype did not: folders,
 * attachments and permissions.
 */

const projects = [{ id: 5, name: 'Launch campaign' }]
const folders = [{ id: 11, project_id: 5, name: 'Pre-production' }]
const users = [
  { id: 9, first_name: 'Casey', last_name: 'Worker' },
  { id: 12, first_name: 'Marco', last_name: 'Diaz' },
]
const statusOptions = [{ id: 21, label: 'In progress' }]
const typeOptions = [{ id: 31, label: 'Milestone' }]
const urgencyOptions = [{ id: 41, label: 'High' }]

function renderModal(overrides: Partial<ComponentProps<typeof CreateTaskModal>> = {}) {
  const onSubmit = vi.fn()
  const onClose = vi.fn()
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
    onClose,
    onSubmit,
    ...overrides,
  }

  return { ...render(<CreateTaskModal {...props} />), props, onSubmit, onClose }
}

type Actor = ReturnType<typeof userEvent.setup>

/** Restores details if a test has manually collapsed them. */
async function openDetails(actor: Actor) {
  const button = screen.queryByRole('button', { name: 'Add details' })
  if (button) await actor.click(button)
}

const title = () => screen.getByLabelText('Task title')

describe('CreateTaskModal', () => {
  it('opens focused on one field, with Create inert until something is typed', async () => {
    const actor = userEvent.setup()
    const { onSubmit } = renderModal()

    await waitFor(() => expect(title()).toHaveFocus())
    expect(title()).toHaveAttribute('placeholder', 'What needs doing?')

    const create = screen.getByRole('button', { name: /Create/ })
    expect(create).toBeDisabled()
    await actor.click(create)
    expect(onSubmit).not.toHaveBeenCalled()

    expect(screen.getByRole('button', { name: 'Assignee' })).toBeInTheDocument()
    expect(screen.getByLabelText('Notes')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add details' })).not.toBeInTheDocument()
  })

  it('lifts @assignee, !priority and a due date out of the title and shows them as chips', async () => {
    const actor = userEvent.setup()
    renderModal()

    await actor.type(title(), 'Ship copy tomorrow @casey !high')

    // The last token is still being typed, so it stays in the field until
    // something follows it — otherwise a longer name could never be finished.
    expect(title()).toHaveValue('Ship copy !high')
    expect(screen.getByRole('button', { name: 'Assignee' })).toHaveTextContent('Casey Worker')
    expect(screen.getByText('Tomorrow')).toBeInTheDocument()

    // The space the user just pressed survives, so the next word does not land
    // against the last one.
    await actor.type(title(), ' ')
    expect(title()).toHaveValue('Ship copy ')
    expect(screen.getByRole('button', { name: 'Urgency' })).toHaveTextContent('High')
  })

  it('leaves unmatched tokens in the title untouched', async () => {
    const actor = userEvent.setup()
    renderModal()

    await actor.type(title(), 'Ping @nobody about the deck')

    expect(title()).toHaveValue('Ping @nobody about the deck')
    expect(screen.queryByText('Casey Worker')).not.toBeInTheDocument()
  })

  it('creates on Enter and sends the parsed facts with the payload', async () => {
    const actor = userEvent.setup()
    const { onSubmit } = renderModal()

    await actor.type(title(), '  Ship campaign @casey !high  {Enter}')

    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onSubmit).toHaveBeenCalledWith({
      project_id: '5',
      title: 'Ship campaign',
      urgency_value_id: '41',
      assignee_user_ids: ['9'],
    }, [])
  })

  it('puts several people on the task from one trip through the menu', async () => {
    const actor = userEvent.setup()
    const { onSubmit } = renderModal()

    await actor.type(title(), 'Ship campaign')
    await openDetails(actor)

    // The menu stays open across picks — three people should not be three trips.
    await actor.click(screen.getByRole('button', { name: 'Assignee' }))
    await actor.click(await screen.findByRole('menuitem', { name: 'Casey Worker' }))
    await actor.click(await screen.findByRole('menuitem', { name: 'Marco Diaz' }))
    await actor.keyboard('{Escape}')

    expect(screen.getByRole('button', { name: 'Assignee' })).toHaveTextContent('Casey Worker +1')

    await actor.click(screen.getByRole('button', { name: /Create/ }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Ship campaign', assignee_user_ids: ['9', '12'] }),
      [],
    )
  })

  it('takes a person off the task again, and drops them all for Unassigned', async () => {
    const actor = userEvent.setup()
    const { onSubmit } = renderModal()

    await actor.type(title(), 'Ship campaign @casey @marco ')
    await openDetails(actor)
    expect(screen.getByRole('button', { name: 'Assignee' })).toHaveTextContent('Casey Worker +1')

    // A picked name carries a ✓ into its accessible name, so match on the person.
    await actor.click(screen.getByRole('button', { name: 'Assignee' }))
    await actor.click(await screen.findByRole('menuitem', { name: /Casey Worker/ }))
    await actor.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Assignee' })).toHaveTextContent('Marco Diaz')

    await actor.click(screen.getByRole('button', { name: 'Assignee' }))
    await actor.click(await screen.findByRole('menuitem', { name: /Unassigned/ }))

    expect(screen.getByRole('button', { name: 'Assignee' })).toHaveTextContent('Unassigned')
    await actor.click(screen.getByRole('button', { name: /Create/ }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.not.objectContaining({ assignee_user_ids: expect.anything() }),
      [],
    )
  })

  it('collects several @mentions from the sentence instead of only the first', async () => {
    const actor = userEvent.setup()
    const { onSubmit } = renderModal()

    await actor.type(title(), 'Ship campaign @casey @marco{Enter}')

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Ship campaign', assignee_user_ids: ['9', '12'] }),
      [],
    )
  })

  it('toggles the detail panel on ⌘↵ and keeps a field the user set by hand', async () => {
    const actor = userEvent.setup()
    const { onSubmit } = renderModal()

    await actor.type(title(), 'Ship campaign')
    await actor.keyboard('{Meta>}{Enter}{/Meta}')
    expect(screen.queryByRole('button', { name: 'Status' })).not.toBeInTheDocument()
    await actor.keyboard('{Meta>}{Enter}{/Meta}')

    await actor.click(screen.getByRole('button', { name: 'Status' }))
    await actor.click(await screen.findByRole('menuitem', { name: 'In progress' }))

    // Typing on keeps following the text for everything untouched, and never
    // overwrites the status that was chosen by hand.
    await actor.type(title(), ' tomorrow ')
    expect(screen.getByRole('button', { name: 'Status' })).toHaveTextContent('In progress')

    await actor.click(screen.getByRole('button', { name: /Create/ }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Ship campaign',
      status_value_id: '21',
      due_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    }), [])
  })

  it('adds a checklist step on Enter without creating the task', async () => {
    const actor = userEvent.setup()
    const { onSubmit } = renderModal()

    await actor.type(title(), 'Ship campaign')
    await openDetails(actor)
    await actor.type(screen.getByLabelText('Add a step'), '  Draft the brief  {Enter}')

    expect(screen.getByText('Draft the brief')).toBeInTheDocument()
    expect(screen.getByLabelText('Add a step')).toHaveValue('')
    expect(onSubmit).not.toHaveBeenCalled()

    await actor.click(screen.getByRole('button', { name: /Create/ }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ subtasks: [{ title: 'Draft the brief' }] }),
      [],
    )
  })

  it('warns about a task that already sounds like this one and opens it on request', async () => {
    const actor = userEvent.setup()
    const onOpenTask = vi.fn()
    const { onClose } = renderModal({
      existingTasks: [{ id: 77, title: 'Rotate the leaked staging credentials', project_id: 5 }],
      onOpenTask,
    })

    await actor.type(title(), 'Rotate leaked staging credentials')
    const banner = await screen.findByRole('button', { name: /Similar task exists/ })
    expect(banner).toHaveTextContent('Rotate the leaked staging credentials')

    await actor.click(banner)
    expect(onOpenTask).toHaveBeenCalledWith(77)
    expect(onClose).toHaveBeenCalled()
  })

  it('says nothing about duplicates until there is enough to compare', async () => {
    const actor = userEvent.setup()
    renderModal({ existingTasks: [{ id: 77, title: 'Rotate the leaked staging credentials', project_id: 5 }] })

    await actor.type(title(), 'Rotate')
    expect(screen.queryByRole('button', { name: /Similar task exists/ })).not.toBeInTheDocument()
  })

  it('drafts scope, steps and an estimate with AI, and the draft survives further typing', async () => {
    const actor = userEvent.setup()
    renderModal()

    await actor.type(title(), 'Rotate the leaked staging credentials')
    await actor.click(screen.getByRole('button', { name: 'Draft with AI' }))
    expect(screen.getByText('Drafting scope, owner and steps…')).toBeInTheDocument()

    // The stub answers after 850ms, the same beat a real call would take.
    expect(await screen.findByText('Reproduce on staging', {}, { timeout: 3000 })).toBeInTheDocument()
    expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toContain('Treat as a security fix')
    expect(screen.getByLabelText('Estimate')).toHaveValue('3h')
    expect(screen.getByRole('button', { name: 'Urgency' })).toHaveTextContent('High')

    await actor.type(title(), ' now')
    expect(screen.getByRole('button', { name: 'Urgency' })).toHaveTextContent('High')
  })

  it('reveals folder and type behind the detail panel', async () => {
    const actor = userEvent.setup()
    const { onSubmit } = renderModal()

    await actor.type(title(), 'Ship campaign')
    await openDetails(actor)

    await actor.click(screen.getByRole('button', { name: 'Folder' }))
    await actor.click(await screen.findByRole('menuitem', { name: 'Pre-production' }))
    await actor.click(screen.getByRole('button', { name: 'Type' }))
    await actor.click(await screen.findByRole('menuitem', { name: 'Milestone' }))
    await actor.type(screen.getByLabelText('Notes'), '  Helpful context  ')
    await actor.type(screen.getByLabelText('Estimate'), '90m')

    await actor.click(screen.getByRole('button', { name: /Create/ }))
    expect(onSubmit).toHaveBeenCalledWith({
      project_id: '5',
      title: 'Ship campaign',
      task_folder_id: '11',
      type_value_id: '31',
      description: 'Helpful context',
      estimated_minutes: 90,
    }, [])
  })

  it('sets the due date from the calendar and submits the day that was clicked', async () => {
    const actor = userEvent.setup()
    const { onSubmit } = renderModal()

    await actor.type(title(), 'Ship campaign')
    await openDetails(actor)

    await actor.click(screen.getByRole('button', { name: 'Choose a due date' }))
    const grid = await screen.findByRole('grid')
    const cell = within(grid)
      .getAllByRole('gridcell')
      .find((node) => node.dataset.outside === undefined && within(node).queryByRole('button')?.textContent === '15')
    if (!cell) throw new Error('No selectable 15th in the due date calendar.')
    await actor.click(within(cell).getByRole('button'))

    const picked = cell.dataset.day as string
    // The typed field and the calendar are two ways into one value, so the
    // input has to show what was clicked rather than keeping its own copy.
    await waitFor(() => expect(screen.getByLabelText('Due date')).toHaveValue(picked))

    await actor.click(screen.getByRole('button', { name: /Create/ }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ due_date: picked }), [])
  })

  it('does not offer what the user lacks permission to set', async () => {
    const actor = userEvent.setup()
    renderModal({ canAssign: false, canChangeStatus: false, canEstimate: false, canCreateSubtasks: false })

    await actor.type(title(), 'Ship campaign')
    await openDetails(actor)

    expect(screen.queryByRole('button', { name: 'Assignee' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Status' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Estimate')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Add a step')).not.toBeInTheDocument()
  })

  it('stages files for upload and refuses executables before they reach the API', async () => {
    const actor = userEvent.setup()
    const { onSubmit } = renderModal({ canAttach: true })

    await actor.type(title(), 'Ship campaign')
    await openDetails(actor)

    const storyboard = new File(['frame'], 'storyboard.png', { type: 'image/png' })
    await actor.upload(screen.getByLabelText('Attach files'), storyboard)
    expect(screen.getByText('storyboard.png')).toBeInTheDocument()

    await actor.upload(screen.getByLabelText('Attach files'), new File(['<?php'], 'payload.php', { type: 'text/x-php' }))
    expect(screen.getByRole('alert')).toHaveTextContent('payload.php is an executable or script file.')
    expect(screen.queryByText('payload.php')).not.toBeInTheDocument()

    await actor.click(screen.getByRole('button', { name: /Create/ }))
    expect(onSubmit).toHaveBeenCalledWith({ project_id: '5', title: 'Ship campaign' }, [storyboard])
  })


  it('attaches a file without anybody opening the detail panel', async () => {
    // The picker used to be rendered inside the collapsed panel, so the whole
    // feature read as missing until somebody found "Add details".
    const actor = userEvent.setup()
    const { onSubmit } = renderModal({ canAttach: true })

    await actor.type(title(), 'Ship campaign')
    expect(screen.getByRole('button', { name: 'Attach' })).toBeInTheDocument()

    const storyboard = new File(['frame'], 'storyboard.png', { type: 'image/png' })
    await actor.upload(screen.getByLabelText('Attach files'), storyboard)

    // The count reports what is staged without the panel being opened.
    expect(screen.getByRole('button', { name: '1 attached' })).toBeInTheDocument()

    await actor.click(screen.getByRole('button', { name: /Create/ }))
    expect(onSubmit).toHaveBeenCalledWith({ project_id: '5', title: 'Ship campaign' }, [storyboard])
  })

  it('offers no attach control without the permission', () => {
    renderModal({ canAttach: false })

    expect(screen.queryByRole('button', { name: 'Attach' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Attach files')).not.toBeInTheDocument()
  })

  it('lets Enter build paragraphs in the description instead of submitting', async () => {
    const actor = userEvent.setup()
    const { onSubmit } = renderModal()

    await actor.type(title(), 'Ship campaign')
    await openDetails(actor)

    const notes = screen.getByLabelText('Notes')
    await actor.type(notes, 'First line.{Enter}{Enter}Second paragraph.')

    // Enter stayed in the textarea — the task was not submitted out from under
    // the person still writing.
    expect(onSubmit).not.toHaveBeenCalled()
    expect(notes).toHaveValue('First line.\n\nSecond paragraph.')

    await actor.click(screen.getByRole('button', { name: /Create/ }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'First line.\n\nSecond paragraph.' }),
      [],
    )
  })

  it('hides attachments entirely without the permission', async () => {
    const actor = userEvent.setup()
    renderModal({ canAttach: false })

    await actor.type(title(), 'Ship campaign')
    await openDetails(actor)
    expect(screen.queryByLabelText('Attach files')).not.toBeInTheDocument()
  })

  it('closes on Escape while the form is still empty, with nothing to lose', async () => {
    const actor = userEvent.setup()
    const { onClose } = renderModal()

    await actor.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('ignores a click on the scrim, however much has been typed', async () => {
    // A stray click beside the modal used to discard the whole draft. Nothing
    // about missing the panel says "throw this away".
    const actor = userEvent.setup()
    const { onClose, container } = renderModal()

    await actor.type(title(), 'Ship campaign')
    const scrim = container.firstElementChild as HTMLElement
    await actor.click(scrim)

    expect(onClose).not.toHaveBeenCalled()
    expect(title()).toHaveValue('Ship campaign')
  })

  it('asks before discarding a started task, and stays open when the answer is no', async () => {
    const actor = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { onClose } = renderModal()

    await actor.type(title(), 'Ship campaign')
    await actor.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(confirm).toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(title()).toHaveValue('Ship campaign')
    confirm.mockRestore()
  })

  it('discards the draft once that is what the person actually asked for', async () => {
    const actor = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { onClose } = renderModal()

    await actor.type(title(), 'Ship campaign')
    await actor.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalledOnce()
    confirm.mockRestore()
  })

  it('picks a project up from the sentence when the modal was not opened inside one', async () => {
    const actor = userEvent.setup()
    const { onSubmit } = renderModal({ initialProjectId: undefined })

    await actor.type(title(), 'Book the launch campaign photographer{Enter}')

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: '5', title: 'Book the launch campaign photographer' }),
      [],
    )
  })
})
