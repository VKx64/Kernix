import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import type { Task, User } from '../types/api'
import { TasksTriagePage } from './TasksTriagePage'

/**
 * Moving a task between folders used to be a column in the task queue table.
 * That table is gone; the same contract now lives behind a row's "⋯" menu on
 * the Triage screen, so this file follows the behaviour there instead.
 */

const authState = vi.hoisted(() => ({ user: null as User | null }))
const workspaceState = vi.hoisted(() => ({ canMutateTasks: true, canAdminOverride: false }))
const folderFailures = vi.hoisted(() => new Set<string>())
const taskState = vi.hoisted(() => ({ tasks: [] as Task[] }))

const apiGet = vi.hoisted(() => vi.fn(async (path: string) => {
  if (folderFailures.has(path)) throw new Error('This project’s folders could not be loaded.')
  if (path === '/api/tasks') {
    return {
      data: taskState.tasks,
      counts: { triage: taskState.tasks.length, mine: 0, all: taskState.tasks.length, unassigned: 0, done: 0 },
      total: taskState.tasks.length,
    }
  }
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
  if (path === '/api/projects/5/task-folders') {
    return { data: [{ id: 11, project_id: 5, name: 'Pre-production', sort_order: 10 }, { id: 12, project_id: 5, name: 'Delivery', sort_order: 20 }] }
  }
  if (path === '/api/projects/6/task-folders') {
    return { data: [{ id: 21, project_id: 6, name: 'Content', sort_order: 10 }] }
  }
  return { data: [] }
}))
const apiPost = vi.hoisted(() => vi.fn(async () => ({ data: { id: 99 } })))
const apiPatch = vi.hoisted(() => vi.fn(async () => ({ data: {} })))
const apiDelete = vi.hoisted(() => vi.fn(async () => ({ data: {} })))

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

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    api: { ...actual.api, get: apiGet, post: apiPost, patch: apiPatch, delete: apiDelete },
  }
})

function bookStudio(): Task {
  return {
    id: 1,
    project_id: 5,
    project: { id: 5, name: 'Launch', client: { id: 4, name: 'Acme' } },
    title: 'Book studio',
    status_value: { id: 100, key: 'in_progress', label: 'In progress', role: 'active' },
    urgency_value: { id: 200, key: 'normal', label: 'Normal', rank: 2 },
    task_folder_id: 11,
    folder: { id: 11, project_id: 5, name: 'Pre-production', sort_order: 10 },
  }
}

async function openRowMenu(actor: ReturnType<typeof userEvent.setup>) {
  await actor.click(await screen.findByRole('button', { name: 'Task actions' }))
}

describe('moving a task to a folder from the Triage row menu', () => {
  beforeEach(() => {
    authState.user = {
      id: 2,
      username: 'producer',
      permissions: ['tasks.view', 'tasks.edit', 'tasks.create', 'projects.view'],
    }
    workspaceState.canMutateTasks = true
    workspaceState.canAdminOverride = false
    taskState.tasks = [bookStudio()]
    folderFailures.clear()
    apiGet.mockClear()
    apiPost.mockClear()
    apiPatch.mockClear()
    apiDelete.mockClear()
  })

  it('sends the chosen folder as a task patch', async () => {
    const actor = userEvent.setup()
    render(<MemoryRouter><TasksTriagePage /></MemoryRouter>)

    await openRowMenu(actor)
    await actor.click(await screen.findByRole('menuitem', { name: /Move to folder/ }))
    await actor.click(await screen.findByRole('menuitem', { name: 'Delivery' }))

    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/api/tasks/1', expect.objectContaining({ task_folder_id: 12 })))
  })

  it('clears the folder when "No folder" is chosen', async () => {
    const actor = userEvent.setup()
    render(<MemoryRouter><TasksTriagePage /></MemoryRouter>)

    await openRowMenu(actor)
    await actor.click(await screen.findByRole('menuitem', { name: /Move to folder/ }))
    await actor.click(await screen.findByRole('menuitem', { name: 'No folder' }))

    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/api/tasks/1', expect.objectContaining({ task_folder_id: null })))
  })

  it('surfaces a failed folder fetch inside the submenu instead of blanking the list', async () => {
    folderFailures.add('/api/projects/5/task-folders')
    const actor = userEvent.setup()
    render(<MemoryRouter><TasksTriagePage /></MemoryRouter>)

    // The row itself must still be there: one project's folders failing must
    // not blank the task list around it.
    expect(await screen.findByText('Book studio')).toBeInTheDocument()

    await openRowMenu(actor)
    await actor.click(await screen.findByRole('menuitem', { name: /Move to folder/ }))
    expect(await screen.findByText('This project’s folders could not be loaded.')).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Delivery' })).not.toBeInTheDocument()
  })

  it('hides the move-to-folder action without tasks.edit', async () => {
    authState.user = { id: 2, username: 'producer', permissions: ['tasks.view'] }
    const actor = userEvent.setup()
    render(<MemoryRouter><TasksTriagePage /></MemoryRouter>)

    await openRowMenu(actor)
    expect(screen.queryByRole('menuitem', { name: /Move to folder/ })).not.toBeInTheDocument()
  })
})
