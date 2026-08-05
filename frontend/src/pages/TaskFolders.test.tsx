import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import type { Column } from '../components/ui'
import type { Project, Task, User } from '../types/api'
import { TaskQueueTable, TasksPage } from './TasksPage'

const authState = vi.hoisted(() => ({ user: null as User | null }))
const workspaceState = vi.hoisted(() => ({ canMutateTasks: true, canAdminOverride: false }))
const reload = vi.hoisted(() => vi.fn(async () => undefined))
const folderFailures = vi.hoisted(() => new Set<string>())
const collectionState = vi.hoisted(() => ({
  data: [] as Task[],
  meta: { page: 1, perPage: 20, total: 0, lastPage: 1 },
  loading: false,
  error: '',
  reload,
}))
const apiGet = vi.hoisted(() => vi.fn(async (path: string) => {
  if (folderFailures.has(path)) throw new Error('This project’s folders could not be loaded.')
  if (path === '/api/bootstrap') {
    return {
      data: {
        projects: [
          { id: 5, name: 'Launch', client: { id: 4, name: 'Acme' } },
          { id: 6, name: 'Website', client: { id: 4, name: 'Acme' } },
        ],
        coworkers: [],
        fields: [],
      },
    }
  }
  if (path === '/api/projects') return { data: [{ id: 5, name: 'Launch' }], current_page: 1, last_page: 1, total: 1 }
  if (path === '/api/projects/5/task-folders') {
    return { data: [{ id: 11, project_id: 5, name: 'Pre-production', sort_order: 10 }, { id: 12, project_id: 5, name: 'Delivery', sort_order: 20 }] }
  }
  if (path === '/api/projects/6/task-folders') {
    return { data: [{ id: 21, project_id: 6, name: 'Content', sort_order: 10 }] }
  }
  return { data: [] }
}))
const apiPost = vi.hoisted(() => vi.fn(async () => ({ data: { id: 13, project_id: 5, name: 'New folder' } })))
const apiPatch = vi.hoisted(() => vi.fn(async () => ({ data: {} })))
const apiDelete = vi.hoisted(() => vi.fn(async () => ({ data: {} })))
const preferenceStorage = new Map<string, string>()
const localStorageMock = {
  getItem: (key: string) => preferenceStorage.get(key) ?? null,
  setItem: (key: string, value: string) => { preferenceStorage.set(key, value) },
  removeItem: (key: string) => { preferenceStorage.delete(key) },
  clear: () => { preferenceStorage.clear() },
  key: (index: number) => [...preferenceStorage.keys()][index] ?? null,
  get length() { return preferenceStorage.size },
} as Storage
Object.defineProperty(window, 'localStorage', { configurable: true, value: localStorageMock })

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: authState.user, status: 'authenticated', login: vi.fn(), logout: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('../auth/WorkspaceProvider', () => ({
  useWorkspace: () => ({
    canMutateTasks: workspaceState.canMutateTasks,
    canAdminOverride: workspaceState.canAdminOverride,
    adminOverride: false,
    setAdminOverride: vi.fn(),
    timeBusy: false,
    timeAction: vi.fn(),
  }),
}))

vi.mock('../lib/useCollection', () => ({
  useCollection: () => collectionState,
}))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    api: { ...actual.api, get: apiGet, post: apiPost, patch: apiPatch, delete: apiDelete },
  }
})

const columns: Column<Task>[] = [
  { key: 'title', header: 'Task', render: (task) => task.title },
]

type Actor = ReturnType<typeof userEvent.setup>

/** Scoped to the popup: the page's native filter selects expose options too. */
async function choose(actor: Actor, field: string, option: string) {
  await actor.click(screen.getByRole('combobox', { name: field }))
  const menu = await screen.findByRole('listbox', { name: field })
  await actor.click(await within(menu).findByRole('option', { name: option }))
}

describe('TaskQueueTable', () => {
  it('renders tasks in one flat table without project or folder group sections', () => {
    const project: Project = { id: 5, name: 'Launch' }
    const tasks: Task[] = [
      { id: 1, project_id: 5, project, title: 'Book studio', task_folder_id: 11, folder: { id: 11, project_id: 5, name: 'Pre-production', sort_order: 10 } },
      { id: 2, project_id: 5, project, title: 'Confirm delivery', task_folder_id: null },
    ]

    render(<TaskQueueTable tasks={tasks} columns={columns} />)

    expect(screen.getByText('Book studio')).toBeInTheDocument()
    expect(screen.getByText('Confirm delivery')).toBeInTheDocument()
    expect(screen.getAllByRole('table')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /Collapse/ })).not.toBeInTheDocument()
  })

  it('offers a focused folder-change action without grouping the queue', async () => {
    const actor = userEvent.setup()
    const onMove = vi.fn()
    const launch: Project = { id: 5, name: 'Launch' }
    const website: Project = { id: 6, name: 'Website' }
    const tasks: Task[] = [
      { id: 1, project_id: 5, project: launch, title: 'Book studio', task_folder_id: 11, folder: { id: 11, project_id: 5, name: 'Pre-production' } },
      { id: 2, project_id: 6, project: website, title: 'Write copy', task_folder_id: 21, folder: { id: 21, project_id: 6, name: 'Content' } },
    ]

    render(<TaskQueueTable tasks={tasks} columns={columns} canMove onMoveTask={onMove} foldersByProject={{
      5: [{ id: 11, project_id: 5, name: 'Pre-production' }, { id: 12, project_id: 5, name: 'Delivery' }],
      6: [{ id: 21, project_id: 6, name: 'Content' }],
    }} />)

    await actor.click(screen.getByRole('button', { name: 'Change folder for Book studio' }))
    const dialog = screen.getByRole('dialog', { name: 'Change folder' })
    expect(dialog).toHaveClass('modal-sm', 'task-folder-dialog')
    expect(dialog.querySelector('form.entity-form')).toBeInTheDocument()
    const launchMove = screen.getByRole('combobox', { name: 'Folder destination' })
    expect(within(launchMove).getByRole('option', { name: 'Delivery' })).toBeInTheDocument()
    expect(within(launchMove).queryByRole('option', { name: 'Content' })).not.toBeInTheDocument()
    await actor.selectOptions(launchMove, '12')
    await actor.click(screen.getByRole('button', { name: 'Move task' }))
    expect(onMove).toHaveBeenCalledWith(tasks[0], '12')
  })
})

describe('TasksPage project folders', () => {
  beforeEach(() => {
    authState.user = {
      id: 2,
      username: 'producer',
      permissions: ['tasks.view', 'tasks.create', 'tasks.edit', 'projects.view', 'projects.edit', 'time.track'],
    }
    workspaceState.canMutateTasks = true
    workspaceState.canAdminOverride = false
    collectionState.data = [{
      id: 1,
      project_id: 5,
      project: { id: 5, name: 'Launch', client: { id: 4, name: 'Acme' } },
      title: 'Book studio',
      task_folder_id: 11,
      folder: { id: 11, project_id: 5, name: 'Pre-production' },
    }]
    collectionState.meta = { page: 1, perPage: 20, total: 1, lastPage: 1 }
    reload.mockClear()
    apiGet.mockClear()
    apiPost.mockClear()
    apiPatch.mockClear()
    apiDelete.mockClear()
    folderFailures.clear()
    window.localStorage.clear()
  })

  it('creates, renames, deletes, and moves within the selected project folder contract', async () => {
    const actor = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<MemoryRouter initialEntries={['/tasks?project_id=5']}><TasksPage /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: 'Tasks' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Project filter' })).toHaveTextContent('Launch')
    expect(screen.queryByRole('button', { name: /Collapse/ })).not.toBeInTheDocument()

    await actor.click(screen.getByText('Folders'))
    await actor.click(screen.getByRole('button', { name: 'New folder' }))
    await actor.type(screen.getByLabelText(/^Folder name/), 'Review')
    await actor.click(screen.getByRole('button', { name: 'Create folder' }))
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/projects/5/task-folders', { name: 'Review' }))

    await actor.click(screen.getByRole('button', { name: 'Rename Pre-production' }))
    const folderName = screen.getByLabelText(/^Folder name/)
    await actor.clear(folderName)
    await actor.type(folderName, 'Planning')
    await actor.click(screen.getByRole('button', { name: 'Save folder' }))
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/api/projects/5/task-folders/11', { name: 'Planning' }))

    await actor.click(screen.getByRole('button', { name: 'Change folder for Book studio' }))
    await actor.selectOptions(screen.getByRole('combobox', { name: 'Folder destination' }), '12')
    await actor.click(screen.getByRole('button', { name: 'Move task' }))
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/api/tasks/1', { task_folder_id: '12', admin_override: undefined }))

    await actor.click(screen.getByRole('button', { name: 'Delete Delivery' }))
    expect(confirm).toHaveBeenCalledWith('Delete “Delivery”? Its tasks will become Ungrouped.')
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/api/projects/5/task-folders/12', { admin_override: undefined }))
    confirm.mockRestore()
  })

  it('prefills and locks the filtered project while offering that project folders on task creation', async () => {
    const actor = userEvent.setup()
    render(<MemoryRouter initialEntries={['/tasks?project_id=5']}><TasksPage /></MemoryRouter>)

    await actor.click(await screen.findByRole('button', { name: 'New task' }))
    const project = await screen.findByRole('combobox', { name: 'Project' })
    expect(project).toHaveTextContent('Launch')
    expect(project).toBeDisabled()
    await actor.type(screen.getByLabelText(/^Task title/), 'Schedule review')
    await choose(actor, 'Folder', 'Delivery')
    await actor.click(screen.getByRole('button', { name: 'Create task' }))

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/tasks', expect.objectContaining({
      title: 'Schedule review',
      project_id: '5',
      task_folder_id: '12',
    })))
  })

  it('loads folders on global creation and clears a folder when the project changes', async () => {
    const actor = userEvent.setup()
    render(<MemoryRouter initialEntries={['/tasks']}><TasksPage /></MemoryRouter>)

    await actor.click(screen.getByRole('button', { name: 'New task' }))
    await screen.findByRole('combobox', { name: 'Project' })
    const folder = screen.getByRole('combobox', { name: 'Folder' })
    expect(folder).toBeDisabled()

    await choose(actor, 'Project', 'Launch')
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Folder' })).toBeEnabled())
    await choose(actor, 'Folder', 'Delivery')
    expect(screen.getByRole('combobox', { name: 'Folder' })).toHaveTextContent('Delivery')

    await choose(actor, 'Project', 'Website')
    expect(screen.getByRole('combobox', { name: 'Folder' })).toHaveTextContent('Ungrouped')
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Folder' })).toBeEnabled())
    await choose(actor, 'Folder', 'Content')
    await actor.type(screen.getByLabelText(/^Task title/), 'Write homepage copy')
    await actor.click(screen.getByRole('button', { name: 'Create task' }))

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/tasks', expect.objectContaining({
      title: 'Write homepage copy',
      project_id: '6',
      task_folder_id: '21',
    })))
  })

  it('keeps successful project folder moves available when another project fails to load', async () => {
    const actor = userEvent.setup()
    folderFailures.add('/api/projects/6/task-folders')
    collectionState.data = [
      collectionState.data[0],
      {
        id: 2,
        project_id: 6,
        project: { id: 6, name: 'Website', client: { id: 4, name: 'Acme' } },
        title: 'Write copy',
        task_folder_id: 21,
        folder: { id: 21, project_id: 6, name: 'Content' },
      },
    ]
    collectionState.meta = { page: 1, perPage: 20, total: 2, lastPage: 1 }

    render(<MemoryRouter initialEntries={['/tasks']}><TasksPage /></MemoryRouter>)

    const launchMove = await screen.findByRole('button', { name: 'Change folder for Book studio' })
    const websiteMove = await screen.findByRole('button', { name: 'Change folder for Write copy' })
    await waitFor(() => expect(launchMove).toBeEnabled())
    expect(websiteMove).toBeDisabled()

    await actor.click(launchMove)
    expect(within(screen.getByRole('combobox', { name: 'Folder destination' })).getByRole('option', { name: 'Delivery' })).toBeInTheDocument()
  })

  it('persists column visibility and width preferences', async () => {
    const actor = userEvent.setup()
    render(<MemoryRouter initialEntries={['/tasks?project_id=5']}><TasksPage /></MemoryRouter>)

    expect(await screen.findByRole('columnheader', { name: 'Status' })).toBeInTheDocument()
    await actor.click(screen.getByText('Columns'))
    await actor.click(screen.getByLabelText('Status'))
    expect(screen.queryByRole('columnheader', { name: 'Status' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Task column width'), { target: { value: '360' } })
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem('kernix.task-columns.v1') ?? '{}')).toEqual(expect.objectContaining({
      visible: expect.objectContaining({ status: false }),
      widths: expect.objectContaining({ title: 360 }),
    })))
  })
})
