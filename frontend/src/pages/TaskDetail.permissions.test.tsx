import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { TaskDetailPage } from './TasksPage'
import { stubTimer } from '../lib/timerStub'
import type { User } from '../types/api'

const authState = vi.hoisted(() => ({ user: null as User | null }))
const workspaceState = vi.hoisted(() => ({ canMutateTasks: true, canAdminOverride: false, isOnBreak: false, adminOverride: false }))
const timeAction = vi.hoisted(() => vi.fn(async () => undefined))
const setAdminOverride = vi.hoisted(() => vi.fn())
const apiPost = vi.hoisted(() => vi.fn(async () => ({ data: {} })))
const timerState = vi.hoisted(() => ({ timer: null as unknown as import('../lib/useTimer').Timer }))

vi.mock('../lib/useTimer', () => ({ useTimerContext: () => timerState.timer }))
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
        estimated_minutes: 120,
        actual_minutes: 30,
        notes: [],
        subtasks: [{ id: 21, title: 'Render export', estimated_minutes: 30 }],
        emails: [{ id: 31, body: 'Approved', subject: 'Launch approval', to_addresses: 'client@example.com' }],
        timeTotals: { totalEstimated: 150, taskActual: 30 },
      },
    }
  }
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

describe('task detail permission controls', () => {
  beforeEach(() => {
    authState.user = { id: 2, username: 'producer', permissions: ['dashboard.view', 'tasks.view', 'time.track'] }
    workspaceState.canMutateTasks = true
    workspaceState.canAdminOverride = false
    workspaceState.isOnBreak = false
    workspaceState.adminOverride = false
    timerState.timer = stubTimer()
    apiGet.mockClear()
    apiPost.mockClear()
    timeAction.mockClear()
    setAdminOverride.mockClear()
  })

  it('exposes email, assignment, estimate, and archive controls without leaking unrelated edit controls', async () => {
    const actor = userEvent.setup()
    authState.user = {
      id: 2,
      username: 'producer',
      // `tasks.work_unassigned` keeps this test focused on permission-based
      // control surfacing, independent of the separate assignment gate.
      permissions: ['dashboard.view', 'tasks.view', 'time.track', 'tasks.assign', 'tasks.estimate', 'tasks.email', 'tasks.archive', 'tasks.work_unassigned'],
    }
    renderTask()

    expect(await screen.findByRole('heading', { name: 'Prepare launch' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Emails' })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Share an update…')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Add a subtask…')).not.toBeInTheDocument()

    await actor.click(screen.getByRole('button', { name: 'Edit task' }))
    expect(screen.getByLabelText('Assignee')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Assignee' })).toHaveTextContent('Casey Worker')
    expect(screen.getByLabelText('Estimated minutes')).toBeInTheDocument()
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Description')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Status')).not.toBeInTheDocument()

    await actor.click(screen.getByRole('button', { name: 'Cancel' }))
    await actor.click(screen.getByRole('tab', { name: 'Emails' }))
    expect(screen.getByRole('button', { name: /Send email/i })).toBeInTheDocument()
  })

  it('keeps email, edit, and archive controls absent for a task viewer', async () => {
    renderTask()

    expect(await screen.findByRole('heading', { name: 'Prepare launch' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Emails' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit task' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()
  })

  it('offers the one workspace-wide administrator override from the clock gate', async () => {
    const actor = userEvent.setup()
    authState.user = { id: 1, username: 'admin', is_admin: true, permissions: [] }
    workspaceState.canMutateTasks = false
    workspaceState.canAdminOverride = true
    renderTask()

    expect(await screen.findByText('Start tracking to make task changes')).toBeInTheDocument()
    const overrideCheckbox = screen.getByLabelText('Work with administrator override')
    const overrideHelp = screen.getByRole('button', { name: 'About administrator override' })
    const overrideTooltip = screen.getByRole('tooltip')
    expect(overrideCheckbox).toHaveAttribute('aria-describedby', overrideTooltip.id)
    expect(overrideHelp).toHaveAttribute('aria-describedby', overrideTooltip.id)
    expect(overrideTooltip).toHaveTextContent('Lets you make task changes without clocking in to an active work session.')

    // Exactly one switch on the page — no per-form copies.
    expect(screen.getAllByLabelText('Work with administrator override')).toHaveLength(1)
    await actor.click(overrideCheckbox)
    expect(setAdminOverride).toHaveBeenCalledWith(true)
  })

  it('offers ending the break and never exposes administrator override during a break', async () => {
    const actor = userEvent.setup()
    authState.user = { id: 1, username: 'admin', is_admin: true, permissions: [] }
    workspaceState.canMutateTasks = false
    workspaceState.canAdminOverride = false
    workspaceState.isOnBreak = true
    renderTask()

    expect(await screen.findByText('End your break to make task changes')).toBeInTheDocument()
    expect(screen.queryByLabelText('Work with administrator override')).not.toBeInTheDocument()
    // Resuming the timer, not the bare attendance endpoint: a break holds a
    // timer entry too, and ending one without the other strands the sidebar.
    await actor.click(screen.getByRole('button', { name: 'End break' }))
    expect(timerState.timer.resume).toHaveBeenCalled()
    expect(timeAction).not.toHaveBeenCalled()
  })

  it('lets the current assignee explain and submit an additional estimate request', async () => {
    const actor = userEvent.setup()
    authState.user = {
      id: 3,
      username: 'casey',
      permissions: ['dashboard.view', 'tasks.view', 'tasks.comment', 'messages.view', 'tasks.request_estimate'],
    }
    renderTask()

    await actor.click(await screen.findByRole('button', { name: 'Request more time' }))
    await actor.clear(screen.getByLabelText('Additional minutes needed'))
    await actor.type(screen.getByLabelText('Additional minutes needed'), '45')
    await actor.type(screen.getByLabelText('Why do you need more time?'), 'The final review added another production pass.')
    await actor.click(screen.getByRole('button', { name: 'Send request' }))

    expect(apiPost).toHaveBeenCalledWith('/api/tasks/9/estimate-requests', expect.objectContaining({
      additional_minutes: 45,
      reason: 'The final review added another production pass.',
    }))
  })
})
