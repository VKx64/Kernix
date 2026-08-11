import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TaskFolder, User } from '@/types/api'
import { ProjectFoldersPanel } from './ProjectFoldersPanel'

/**
 * The only screen where folders are created, nested, moved and removed. What
 * matters here is the shape sent to the server — the tree the panel draws is
 * rebuilt from whatever comes back, so a wrong request is invisible until the
 * reload lands.
 */

const authState = vi.hoisted(() => ({ user: null as User | null }))
const folderState = vi.hoisted(() => ({ folders: [] as TaskFolder[] }))

const apiGet = vi.hoisted(() => vi.fn(async () => ({ data: folderState.folders })))
const apiPost = vi.hoisted(() => vi.fn(async () => ({ data: { id: 99 } })))
const apiPatch = vi.hoisted(() => vi.fn(async () => ({ data: {} })))
const apiDelete = vi.hoisted(() => vi.fn(async () => ({ data: {} })))

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: authState.user, status: 'authenticated', login: vi.fn(), logout: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/auth/WorkspaceProvider', () => ({
  useWorkspace: () => ({ adminOverride: false, canAdminOverride: false, canMutateTasks: true }),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, get: apiGet, post: apiPost, patch: apiPatch, delete: apiDelete } }
})

function tree(): TaskFolder[] {
  return [
    { id: 1, project_id: 5, parent_id: null, name: 'Design', sort_order: 10 },
    { id: 2, project_id: 5, parent_id: 1, name: 'Drafts', sort_order: 10 },
    { id: 3, project_id: 5, parent_id: 2, name: 'Rejected', sort_order: 10 },
    { id: 4, project_id: 5, parent_id: null, name: 'Build', sort_order: 20 },
  ]
}

describe('the project folder panel', () => {
  beforeEach(() => {
    authState.user = { id: 2, username: 'lead', permissions: ['tasks.view', 'projects.view', 'projects.edit'] }
    folderState.folders = tree()
    apiGet.mockClear(); apiPost.mockClear(); apiPatch.mockClear(); apiDelete.mockClear()
  })

  it('nests children under their parent and hides a collapsed branch', async () => {
    const actor = userEvent.setup()
    render(<ProjectFoldersPanel projectId={5} />)

    await screen.findByText('Design')
    expect(screen.getByText('Rejected')).toBeInTheDocument()

    await actor.click(screen.getByRole('button', { name: 'Collapse Design' }))
    // The whole branch goes, not just the folder directly beneath.
    expect(screen.queryByText('Drafts')).not.toBeInTheDocument()
    expect(screen.queryByText('Rejected')).not.toBeInTheDocument()
    expect(screen.getByText('Build')).toBeInTheDocument()
  })

  it('creates a subfolder against the parent it was opened from', async () => {
    const actor = userEvent.setup()
    render(<ProjectFoldersPanel projectId={5} />)

    await screen.findByText('Build')
    await actor.click(screen.getByRole('button', { name: 'Add a subfolder in Build' }))
    await actor.type(screen.getByRole('textbox', { name: 'New subfolder in Build' }), 'Sprint one')
    await actor.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/projects/5/task-folders', {
      name: 'Sprint one',
      parent_id: '4',
    }))
  })

  it('creates a top-level folder with no parent', async () => {
    const actor = userEvent.setup()
    render(<ProjectFoldersPanel projectId={5} />)

    await actor.click(await screen.findByRole('button', { name: /New folder/ }))
    await actor.type(screen.getByRole('textbox', { name: 'New folder name' }), 'Launch')
    await actor.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/projects/5/task-folders', {
      name: 'Launch',
      parent_id: null,
    }))
  })

  it('never offers a move that would put a folder inside its own subtree', async () => {
    const actor = userEvent.setup()
    render(<ProjectFoldersPanel projectId={5} />)

    await screen.findByText('Design')
    await actor.click(screen.getByRole('button', { name: 'Actions for Design' }))
    const menu = await screen.findByRole('menu')

    expect(within(menu).queryByRole('menuitem', { name: /Move into Design/ })).not.toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: /Drafts/ })).not.toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Move into Build' })).toBeInTheDocument()
  })

  it('leaves out targets where the moved branch would not fit under the cap', async () => {
    const actor = userEvent.setup()
    // Design's branch is three levels tall. Under Deep (level 2) it ends at
    // level 5, which is the cap; under Deeper (level 3) it would reach 6.
    folderState.folders = [
      ...tree(),
      { id: 5, project_id: 5, parent_id: 4, name: 'Deep', sort_order: 10 },
      { id: 6, project_id: 5, parent_id: 5, name: 'Deeper', sort_order: 10 },
    ]
    render(<ProjectFoldersPanel projectId={5} />)

    await screen.findByText('Design')
    await actor.click(screen.getByRole('button', { name: 'Actions for Design' }))
    const menu = await screen.findByRole('menu')

    expect(within(menu).getByRole('menuitem', { name: 'Move into Build / Deep' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Move into Build / Deep / Deeper' })).not.toBeInTheDocument()
  })

  it('warns that subfolders are promoted rather than deleted', async () => {
    const actor = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<ProjectFoldersPanel projectId={5} />)

    await screen.findByText('Design')
    await actor.click(screen.getByRole('button', { name: 'Actions for Design' }))
    await actor.click(await screen.findByRole('menuitem', { name: /Delete/ }))

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('2 subfolders move up a level'))
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/api/projects/5/task-folders/1', undefined))
    confirm.mockRestore()
  })

  it('offers no folder actions without projects.edit', async () => {
    authState.user = { id: 3, username: 'viewer', permissions: ['tasks.view'] }
    render(<ProjectFoldersPanel projectId={5} />)

    await screen.findByText('Design')
    expect(screen.queryByRole('button', { name: /New folder/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Actions for Design' })).not.toBeInTheDocument()
  })
})
