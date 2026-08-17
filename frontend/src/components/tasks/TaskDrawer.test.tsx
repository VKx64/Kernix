import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import type { ComponentProps } from 'react'
import { TaskDrawer } from './TaskDrawer'
import type { Subtask, Task } from '../../types/api'

const apiPost = vi.hoisted(() => vi.fn(async () => ({ data: {} })))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, post: apiPost } }
})

/**
 * The task shown in the drawer already carries its attachments (the detail
 * fetch that feeds the drawer loads them alongside notes and subtasks), so
 * this only has to prove the drawer wires `task.attachments` and the file
 * permissions through to `TaskDrawerFiles`. `TaskDrawerFiles.test.tsx` covers
 * the FILES section's own layout rules in depth, and `TaskDrawerSubtasks`
 * covers the SUBTASKS section's own request handling the same way.
 */
function baseTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 48,
    title: 'Testing image UPload',
    ...overrides,
  } as Task
}

function renderDrawer(task: Task | null, overrides: Partial<ComponentProps<typeof TaskDrawer>> = {}) {
  return render(
    <MemoryRouter>
      <TaskDrawer
        task={task}
        loading={false}
        fields={[]}
        feed={[]}
        showEvents
        commentCount={0}
        canComment={false}
        canComplete={false}
        commentBusy={false}
        hasPrevious={false}
        hasNext={false}
        onToggleEvents={() => {}}
        onClose={() => {}}
        onPrevious={() => {}}
        onNext={() => {}}
        onToggleSubtask={() => {}}
        onComment={async () => {}}
        onComplete={() => {}}
        timerRunning={false}
        timerSeconds={0}
        timerBusy={false}
        canTrackTime={false}
        canLogTime={false}
        onToggleTimer={() => {}}
        canManageFiles={false}
        onFilesChanged={() => {}}
        canCreateSubtasks={false}
        onSubtasksChanged={() => {}}
        {...overrides}
      />
    </MemoryRouter>,
  )
}

describe('TaskDrawer attachments', () => {
  it('shows an uploaded file as a lone tile with its metadata beside it', () => {
    const task = baseTask({
      attachments: [
        { id: 3, task_id: 48, original_name: 'shot.png', mime_type: 'image/png', file_size: 2048, can_preview: true },
      ],
    })

    renderDrawer(task)

    expect(screen.getByText('Files')).toBeInTheDocument()
    expect(screen.getByText('shot.png')).toBeInTheDocument()
    expect(screen.getByAltText('shot.png')).toHaveAttribute('src', '/api/tasks/48/attachments/3?inline=1')
    expect(screen.getByLabelText('Download shot.png')).toHaveAttribute('href', '/api/tasks/48/attachments/3')
  })

  it('hides the files section for a viewer who cannot upload when the task has nothing attached', () => {
    renderDrawer(baseTask({ attachments: [] }), { canManageFiles: false })

    expect(screen.queryByText('Files')).not.toBeInTheDocument()
  })

  it('offers an Add control and the empty dropzone once the viewer can manage files', () => {
    renderDrawer(baseTask({ attachments: [] }), { canManageFiles: true })

    expect(screen.getByText('Files')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
    expect(screen.getByText('browse')).toBeInTheDocument()
  })
})

describe('TaskDrawer subtasks', () => {
  beforeEach(() => { apiPost.mockClear() })

  const subtask = (overrides: Partial<Subtask> = {}): Subtask => ({
    id: 9,
    task_id: 48,
    title: 'Draft outline',
    ...overrides,
  })

  it('hides the Add control from a viewer without tasks.subtasks', () => {
    renderDrawer(baseTask({ subtasks: [subtask()] }), { canCreateSubtasks: false })

    expect(screen.getByText('Subtasks')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument()
  })

  it('is reachable on a task with zero subtasks once the viewer can create one', () => {
    renderDrawer(baseTask({ subtasks: [] }), { canCreateSubtasks: true })

    expect(screen.getByText('Subtasks')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
  })

  it('hides the whole section for a viewer who cannot create subtasks when there are none', () => {
    renderDrawer(baseTask({ subtasks: [] }), { canCreateSubtasks: false })

    expect(screen.queryByText('Subtasks')).not.toBeInTheDocument()
  })

  it('posts a new subtask on Enter and keeps the input open', async () => {
    const user = userEvent.setup()
    renderDrawer(baseTask({ subtasks: [] }), { canCreateSubtasks: true })

    await user.click(screen.getByRole('button', { name: 'Add' }))
    const input = screen.getByLabelText('New subtask title')
    await user.type(input, 'Check camera batteries')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/api/tasks/48/subtasks', { title: 'Check camera batteries', admin_override: undefined })
    })
    const reopenedInput = screen.getByLabelText('New subtask title')
    expect(reopenedInput).toBeInTheDocument()
    // Rendered isn't enough — the whole point of staying open is that the
    // next title can be typed immediately, which only works if focus is
    // still on the input, not merely that it still exists in the DOM.
    await waitFor(() => expect(document.activeElement).toBe(reopenedInput))
  })

  it('does not post a subtask for whitespace-only input', async () => {
    const user = userEvent.setup()
    renderDrawer(baseTask({ subtasks: [] }), { canCreateSubtasks: true })

    await user.click(screen.getByRole('button', { name: 'Add' }))
    const input = screen.getByLabelText('New subtask title')
    await user.type(input, '   ')
    await user.keyboard('{Enter}')

    expect(apiPost).not.toHaveBeenCalled()
  })

  it('cancels the input on Escape without letting the key bubble up to close the drawer', async () => {
    // Mirrors the window-level Escape handler that actually closes the
    // drawer in TasksTriagePage — proving the input stops the key before it
    // gets there, not just that the drawer's own onClose was never called.
    const onWindowEscape = vi.fn()
    const listener = (event: KeyboardEvent) => { if (event.key === 'Escape') onWindowEscape() }
    window.addEventListener('keydown', listener)

    const user = userEvent.setup()
    renderDrawer(baseTask({ subtasks: [] }), { canCreateSubtasks: true })

    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.keyboard('{Escape}')

    expect(screen.queryByLabelText('New subtask title')).not.toBeInTheDocument()
    expect(onWindowEscape).not.toHaveBeenCalled()

    window.removeEventListener('keydown', listener)
  })
})


/**
 * Two things the drawer used to leave to guesswork: how long a task has taken,
 * and whether the timer somebody just started is running at all.
 */
it('counts the running clock where the person can see it', async () => {
  renderDrawer(baseTask({ actual_minutes: 30 }), {
    canTrackTime: true,
    timerRunning: true,
    timerSeconds: 4325,
  })

  expect(await screen.findByLabelText('Time on this run')).toHaveTextContent('01:12:05')
  // The run counts towards the total as it happens, so 30m logged plus 72
  // minutes on the clock reads as 1h 42m rather than a stale half hour.
  expect(screen.getByText(/1h 42m logged/)).toBeInTheDocument()
})

it('says what a task has taken, and shows no clock when none is running', async () => {
  renderDrawer(baseTask({ actual_minutes: 95 }), { canTrackTime: true })

  expect(await screen.findByText(/1h 35m logged/)).toBeInTheDocument()
  expect(screen.queryByLabelText('Time on this run')).not.toBeInTheDocument()
})

it('logs time beside the comment, in whatever shape it was written', async () => {
  const onComment = vi.fn(async () => {})
  const actor = userEvent.setup()
  renderDrawer(baseTask(), { canComment: true, canLogTime: true, onComment })

  await actor.type(screen.getByLabelText('Time spent'), '1.5h')
  await actor.type(screen.getByPlaceholderText(/Write a comment/), 'Rebuilt the export{Enter}')

  await waitFor(() => expect(onComment).toHaveBeenCalledWith('Rebuilt the export', 90))
})

it('lets time be logged on its own, with no comment to invent', async () => {
  const onComment = vi.fn(async () => {})
  const actor = userEvent.setup()
  renderDrawer(baseTask(), { canComment: true, canLogTime: true, onComment })

  await actor.type(screen.getByLabelText('Time spent'), '45{Enter}')

  await waitFor(() => expect(onComment).toHaveBeenCalledWith('', 45))
})

it('keeps the time box away from anybody who may not log time', () => {
  renderDrawer(baseTask(), { canComment: true, canLogTime: false })

  expect(screen.queryByLabelText('Time spent')).not.toBeInTheDocument()
})
