import { render, screen } from '@testing-library/react'
import { NotesTab, SubtasksTab } from './TasksPage'

const noop = () => undefined

describe('task capability controls', () => {
  it('lets comment-only users write without exposing time logging', () => {
    render(<NotesTab notes={[]} body="" minutes={0} notifyUserId="" users={[]} busy={false} canComment canLogTime={false} canEdit={() => false} canDelete={() => false} onBody={noop} onMinutes={noop} onNotifyUser={noop} onAdd={noop} onEdit={noop} onDelete={noop} />)
    expect(screen.getByPlaceholderText('Share an update…')).toBeInTheDocument()
    expect(screen.queryByText('Time logged')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add note/i })).toBeInTheDocument()
  })

  it('separates subtask management from completion', () => {
    const subtask = { id: 8, title: 'Render export' }
    const { rerender } = render(<SubtasksTab subtasks={[subtask]} title="" busy={false} canManage={false} canComplete canEditAny={false} onTitle={noop} onAdd={noop} onComplete={noop} onEdit={noop} onDelete={noop} onMove={noop} />)
    expect(screen.queryByPlaceholderText('Add a subtask…')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Complete Render export' })).toBeEnabled()

    rerender(<SubtasksTab subtasks={[subtask]} title="" busy={false} canManage canComplete={false} canEditAny onTitle={noop} onAdd={noop} onComplete={noop} onEdit={noop} onDelete={noop} onMove={noop} />)
    expect(screen.getByPlaceholderText('Add a subtask…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Complete Render export' })).toBeDisabled()
  })
})
