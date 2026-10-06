import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SidebarItemActions } from './SidebarItemActions'

const api = vi.hoisted(() => ({ patch: vi.fn(), post: vi.fn(), delete: vi.fn() }))
vi.mock('@/lib/api', () => ({ api }))
vi.mock('@/lib/permissions', () => ({ useCan: () => () => true }))
const folders = [
  { id: 1, name: 'Source', project_id: 5 },
  { id: 2, name: 'Child', project_id: 5, parent_id: 1 },
  { id: 3, name: 'Destination', project_id: 5 },
  { id: 4, name: 'Archived', project_id: 5, archived_at: '2026-10-07' },
]
const saved = vi.fn()
beforeEach(() => { vi.clearAllMocks(); api.patch.mockResolvedValue({}); api.post.mockResolvedValue({}); api.delete.mockResolvedValue({}) })

function setup() {
  render(<SidebarItemActions name="Source" path="/api/projects/5/task-folders/1" href="/tasks?project_id=5&task_folder_id=1" folder={folders[0]} folders={folders} onSaved={saved} />)
  return userEvent.setup()
}

it('renames through a meatball menu', async () => {
  const actor = setup()
  await actor.click(screen.getByRole('button', { name: 'Actions for Source' }))
  await actor.click(screen.getByRole('menuitem', { name: 'Rename' }))
  await actor.clear(screen.getByRole('textbox', { name: 'Name' }))
  await actor.type(screen.getByRole('textbox', { name: 'Name' }), 'Renamed')
  await actor.click(screen.getByRole('button', { name: 'Confirm' }))
  await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/api/projects/5/task-folders/1', { name: 'Renamed' }))
})

it('offers only valid same-project destinations and sends only parent_id', async () => {
  const actor = setup()
  await actor.click(screen.getByRole('button', { name: 'Actions for Source' }))
  await actor.click(screen.getByRole('menuitem', { name: 'Move to…' }))
  expect(screen.queryByRole('option', { name: 'Source' })).not.toBeInTheDocument()
  expect(screen.queryByRole('option', { name: 'Source / Child' })).not.toBeInTheDocument()
  expect(screen.queryByRole('option', { name: 'Archived' })).not.toBeInTheDocument()
  await actor.selectOptions(screen.getByLabelText('Destination'), '3')
  await actor.click(screen.getByRole('button', { name: 'Confirm' }))
  expect(api.patch).toHaveBeenCalledWith('/api/projects/5/task-folders/1', { parent_id: '3' })
})

it('requires confirmation before deleting and preserves server errors', async () => {
  api.delete.mockRejectedValue(new Error('Clock in first'))
  const actor = setup()
  await actor.click(screen.getByRole('button', { name: 'Actions for Source' }))
  await actor.click(screen.getByRole('menuitem', { name: 'Delete…' }))
  expect(api.delete).not.toHaveBeenCalled()
  expect(screen.getByText(/tasks become ungrouped/)).toBeInTheDocument()
  await actor.click(screen.getByRole('button', { name: 'Delete' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Clock in first')
  expect(saved).not.toHaveBeenCalled()
})

it('defaults duplication to structure only', async () => {
  const actor = setup()
  await actor.click(screen.getByRole('button', { name: 'Actions for Source' }))
  await actor.click(screen.getByRole('menuitem', { name: 'Duplicate…' }))
  expect(screen.getByLabelText('Duplicate contents')).toHaveValue('structure')
  await actor.click(screen.getByRole('button', { name: 'Confirm' }))
  expect(api.post).toHaveBeenCalledWith('/api/projects/5/task-folders/1/duplicate', { name: 'Source (copy)', with_tasks: false })
})
