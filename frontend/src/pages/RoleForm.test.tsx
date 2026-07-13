import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RoleForm } from './EntityPages'
import type { PermissionGroup } from '../lib/rolePermissions'

const groups: PermissionGroup[] = [
  { key: 'dashboard', label: 'Dashboard', permissions: [{ key: 'dashboard.view', label: 'View dashboard', description: 'Required home screen.', requires: [] }] },
  { key: 'time', label: 'Time', permissions: [{ key: 'time.track', label: 'Track time', description: 'Use the timer.', requires: ['dashboard.view'] }] },
  { key: 'tasks', label: 'Tasks', permissions: [
    { key: 'tasks.view', label: 'View tasks', description: 'See tasks.', requires: ['dashboard.view'] },
    { key: 'tasks.edit', label: 'Edit tasks', description: 'Edit metadata.', requires: ['tasks.view', 'time.track'] },
  ] },
]

describe('RoleForm', () => {
  it('starts a custom role with dashboard access and applies dependencies', async () => {
    const save = vi.fn(async () => undefined)
    const actor = userEvent.setup()
    render(<RoleForm role={null} groups={groups} busy={false} error="" readOnly={false} onCancel={() => undefined} onSave={save} />)

    const dashboard = screen.getByRole('checkbox', { name: /View dashboard/i })
    expect(dashboard).toBeChecked()
    expect(dashboard).toBeDisabled()

    await actor.type(screen.getByLabelText(/Role name/i), 'Producer')
    await actor.click(screen.getByRole('checkbox', { name: /Edit tasks/i }))
    expect(screen.getByRole('checkbox', { name: /View tasks/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /View tasks/i })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /Track time/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Track time/i })).toBeDisabled()

    await actor.click(screen.getByRole('button', { name: 'Save role' }))
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Producer', permissions: expect.arrayContaining(['dashboard.view', 'tasks.view', 'time.track', 'tasks.edit']) }))
  })

  it('renders system roles as immutable full access', () => {
    render(<RoleForm role={{ id: 1, name: 'Administrator', key: 'admin', is_system: true }} groups={groups} busy={false} error="" readOnly onCancel={() => undefined} onSave={async () => undefined} />)
    expect(screen.getByText(/System role · Full access/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save role' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(4)
    expect(screen.getAllByRole('checkbox').every((checkbox) => checkbox.hasAttribute('disabled'))).toBe(true)
  })
})
