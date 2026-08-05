import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { TaskDetailPage } from './TasksPage'
import type { User } from '../types/api'

const authState = vi.hoisted(() => ({ user: null as User | null }))
const workspaceState = vi.hoisted(() => ({ canMutateTasks: true, canAdminOverride: false, isOnBreak: false, adminOverride: false }))
const timeAction = vi.hoisted(() => vi.fn(async () => undefined))
const setAdminOverride = vi.hoisted(() => vi.fn())
const apiPost = vi.hoisted(() => vi.fn(async () => ({ data: {} })))
const workRequestsState = vi.hoisted(() => ({ list: [] as Array<Record<string, unknown>> }))

const apiGet = vi.hoisted(() => vi.fn(async (path: string) => {
  if (path === '/api/bootstrap') {
    return {
      data: {
        projects: [{ id: 5, name: 'Launch', client: { id: 4, name: 'Acme' } }],
        assignees: [{ id: 3, first_name: 'Casey', last_name: 'Worker' }],
        fields: [
          { id: 10, key: 'task_status', name: 'Status', values: [{ id: 11, label: 'Open' }] },
          { id: 12, key: 'task_type', name: 'Type', values: [{ id: 13, label: 'Task' }] },
          { id: 14, key: 'task_urgency', name: 'Urgency', values: [{ id: 15, label: 'Normal' }] },
        ],
      },
    }
  }
  if (path === '/api/tasks/9') {
    return {
      data: {
        id: 9,
        title: 'Prepare launch',
        description: 'Final production checks.',
        project: { id: 5, name: 'Launch', client: { id: 4, name: 'Acme' } },
        assignee: { id: 3, first_name: 'Casey', last_name: 'Worker' },
        creator: { id: 3, first_name: 'Casey', last_name: 'Worker' },
        estimated_minutes: 120,
        actual_minutes: 30,
        notes: [],
        subtasks: [],
        emails: [],
        timeTotals: { totalEstimated: 150, taskActual: 30 },
      },
    }
  }
  if (path === '/api/tasks/9/work-requests') return { data: workRequestsState.list }
  if (path === '/api/projects') return { data: [], current_page: 1, last_page: 1, total: 0 }
  return { data: [] }
}))

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: authState.user, status: 'authenticated', login: vi.fn(), logout: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('../auth/WorkspaceProvider', () => ({
  useWorkspace: () => ({
    canMutateTasks: workspaceState.canMutateTasks,
    canAdminOverride: workspaceState.canAdminOverride,
    isOnBreak: workspaceState.isOnBreak,
    adminOverride: workspaceState.adminOverride,
    setAdminOverride,
    timeBusy: false,
    timeAction,
  }),
}))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    api: { ...actual.api, get: apiGet, post: apiPost, patch: vi.fn(), delete: vi.fn() },
  }
})

function renderTask() {
  return render(
    <MemoryRouter initialEntries={['/tasks/9']}>
      <Routes><Route path="/tasks/:taskId" element={<TaskDetailPage />} /></Routes>
    </MemoryRouter>,
  )
}

describe('task work requests', () => {
  beforeEach(() => {
    workRequestsState.list = []
    workspaceState.canMutateTasks = true
    workspaceState.canAdminOverride = false
    workspaceState.isOnBreak = false
    workspaceState.adminOverride = false
    apiGet.mockClear()
    apiPost.mockClear()
    timeAction.mockClear()
    setAdminOverride.mockClear()
  })

  it('shows the request panel for a non-assignee without the work_unassigned permission', async () => {
    authState.user = { id: 8, username: 'bystander', permissions: ['dashboard.view', 'tasks.view', 'tasks.request_work'] }
    renderTask()

    expect(await screen.findByText('You are not assigned to this task')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Request to work on this' })).toBeInTheDocument()
  })

  it('does not show the request panel for the current assignee', async () => {
    authState.user = { id: 3, username: 'casey', permissions: ['dashboard.view', 'tasks.view', 'tasks.comment'] }
    renderTask()

    expect(await screen.findByRole('heading', { name: 'Prepare launch' })).toBeInTheDocument()
    expect(screen.queryByText('You are not assigned to this task')).not.toBeInTheDocument()
  })

  it('submits a work request with the entered reason', async () => {
    const actor = userEvent.setup()
    authState.user = { id: 8, username: 'bystander', permissions: ['dashboard.view', 'tasks.view', 'tasks.request_work'] }
    renderTask()

    await actor.click(await screen.findByRole('button', { name: 'Request to work on this' }))
    await actor.type(screen.getByLabelText(/Why do you want this task/), 'I finished the related asset already.')
    await actor.click(screen.getByRole('button', { name: 'Send request' }))

    expect(apiPost).toHaveBeenCalledWith('/api/tasks/9/work-requests', { reason: 'I finished the related asset already.' })
  })

  it('lets a reviewer approve or decline a pending work request', async () => {
    const actor = userEvent.setup()
    authState.user = { id: 1, username: 'pm', permissions: ['dashboard.view', 'tasks.view', 'tasks.review_work_requests'] }
    workRequestsState.list = [{
      id: 21,
      task_id: 9,
      reason: 'I already have context on this client.',
      status: 'pending',
      requester: { id: 8, first_name: 'Bystander', last_name: 'Person' },
    }]
    renderTask()

    expect(await screen.findByText('Work requests')).toBeInTheDocument()
    expect(screen.getByText('I already have context on this client.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument()

    await actor.click(screen.getByRole('button', { name: 'Approve' }))
    expect(apiPost).toHaveBeenCalledWith('/api/tasks/9/work-requests/21/approve', {})

    await actor.click(screen.getByRole('button', { name: 'Decline' }))
    await actor.type(screen.getByLabelText('Why decline?'), 'This is already assigned to a specialist.')
    await actor.click(screen.getByRole('button', { name: 'Confirm decline' }))
    expect(apiPost).toHaveBeenCalledWith('/api/tasks/9/work-requests/21/decline', { reason: 'This is already assigned to a specialist.' })
  })
})
