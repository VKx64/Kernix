import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { ComponentProps } from 'react'
import { TaskDrawer } from './TaskDrawer'
import type { Task } from '../../types/api'

/**
 * The task shown in the drawer already carries its attachments (the detail
 * fetch that feeds the drawer loads them alongside notes and subtasks), so
 * this only has to prove the drawer wires `task.attachments` and the file
 * permissions through to `TaskDrawerFiles`. `TaskDrawerFiles.test.tsx` covers
 * the FILES section's own layout rules in depth.
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
        timerBusy={false}
        canTrackTime={false}
        onToggleTimer={() => {}}
        canManageFiles={false}
        onFilesChanged={() => {}}
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
