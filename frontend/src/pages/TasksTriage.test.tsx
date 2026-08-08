import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import type { FieldValue, Task, User } from '../types/api'
import { TasksTriagePage } from './TasksTriagePage'

/**
 * The Triage screen end to end, with the API stubbed.
 *
 * The division of labour is the thing worth protecting: the server decides which
 * tasks are in a view and what the tab counts are, and the screen decides how
 * they are grouped, ordered and selected. Several of these cases exist to catch
 * that boundary being crossed — a tab count computed locally, or a view filter
 * applied in the browser.
 */

const STATUSES: FieldValue[] = [
  { id: 10, key: 'pending', label: 'Pending', role: 'open' },
  { id: 11, key: 'in_progress', label: 'In progress', role: 'active' },
  { id: 13, key: 'blocked', label: 'Blocked', role: 'blocked' },
  { id: 14, key: 'complete', label: 'Complete', role: 'done' },
]
const URGENCIES: FieldValue[] = [
  { id: 20, key: 'urgent', label: 'Urgent', rank: 0 },
  { id: 22, key: 'normal', label: 'Normal', rank: 2 },
]

const authState = vi.hoisted(() => ({ user: null as User | null }))
const listState = vi.hoisted(() => ({
  tasks: [] as Task[],
  counts: { triage: 0, mine: 0, all: 0, unassigned: 0, done: 0 },
  total: 0,
}))
const requests = vi.hoisted(() => ({ tasks: [] as Array<Record<string, unknown> | undefined> }))

const apiGet = vi.hoisted(() => vi.fn(async (path: string, query?: Record<string, unknown>) => {
  if (path === '/api/tasks') {
    requests.tasks.push(query)
    return { data: listState.tasks, counts: listState.counts, total: listState.total }
  }
  if (path === '/api/bootstrap') {
    return {
      data: {
        projects: [{ id: 5, name: 'Launch', client: { id: 4, name: 'Acme' } }],
        coworkers: [{ id: 3, first_name: 'Sam', last_name: 'Kaur' }],
        fields: [
          { id: 3, key: 'task_status', values: STATUSES },
          { id: 4, key: 'task_urgency', values: URGENCIES },
          { id: 5, key: 'task_type', values: [{ id: 30, key: 'task', label: 'Task' }] },
        ],
      },
    }
  }
  // Task detail and activity, for the drawer.
  if (/^\/api\/tasks\/\d+$/.test(path)) {
    const id = Number(path.split('/').pop())
    return { data: listState.tasks.find((task) => Number(task.id) === id) }
  }
  return { data: [] }
}))
const apiPost = vi.hoisted(() => vi.fn(async () => ({ data: { id: 99 } })))
const apiPatch = vi.hoisted(() => vi.fn(async () => ({ data: {} })))

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: authState.user, status: 'authenticated', login: vi.fn(), logout: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('../auth/WorkspaceProvider', () => ({
  useWorkspace: () => ({
    canMutateTasks: true,
    canAdminOverride: false,
    adminOverride: false,
    setAdminOverride: vi.fn(),
    timeBusy: false,
    timeAction: vi.fn(),
  }),
}))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, api: { ...actual.api, get: apiGet, post: apiPost, patch: apiPatch } }
})

function iso(dayOffset: number): string {
  const date = new Date()
  date.setDate(date.getDate() + dayOffset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function task(id: number, title: string, overrides: Partial<Task> & { statusId?: number; urgencyId?: number; due?: number | null } = {}): Task {
  const { statusId = 10, urgencyId = 22, due = null, ...rest } = overrides
  return {
    id,
    title,
    project: { id: 5, name: 'Launch', client: { id: 4, name: 'Acme' } },
    status_value: STATUSES.find((option) => option.id === statusId),
    urgency_value: URGENCIES.find((option) => option.id === urgencyId),
    due_date: due === null ? null : iso(due),
    ...rest,
  } as Task
}

function seed() {
  listState.tasks = [
    task(1, 'Awaiting legal sign-off', { statusId: 13 }),
    task(2, 'Send investor deck', { due: -4, statusId: 11, assignee: { id: 3, first_name: 'Sam', last_name: 'Kaur' } }),
    task(3, 'Ship the ad creatives', { due: 0, statusId: 11 }),
  ]
  listState.counts = { triage: 3, mine: 1, all: 12, unassigned: 4, done: 7 }
  listState.total = 3
}

function renderPage(entry = '/tasks') {
  return render(<MemoryRouter initialEntries={[entry]}><TasksTriagePage /></MemoryRouter>)
}

beforeEach(() => {
  authState.user = {
    id: 2,
    username: 'producer',
    permissions: ['tasks.view', 'tasks.edit', 'tasks.create', 'tasks.change_status', 'tasks.assign', 'projects.view'],
  }
  seed()
  requests.tasks = []
  apiGet.mockClear()
  apiPost.mockClear()
  apiPatch.mockClear()
})

/** Group headings are the only expandable buttons on the screen. */
async function groupHeadings(): Promise<string[]> {
  const buttons = await screen.findAllByRole('button', { expanded: true })
  return buttons.map((button) => button.textContent ?? '')
}

describe('Triage grouping', () => {
  it('heads each group with the reason its rows need attention', async () => {
    renderPage()
    await waitFor(async () => {
      const headings = await groupHeadings()
      expect(headings.join(' ')).toContain('Blocked')
      expect(headings.join(' ')).toContain('Overdue')
      expect(headings.join(' ')).toContain('Due today')
    })
  })

  it('shows each task exactly once even when two reasons could claim it', async () => {
    listState.tasks = [task(1, 'Blocked and late', { statusId: 13, due: -6 })]
    listState.total = 1
    renderPage()
    expect(await screen.findAllByText('Blocked and late')).toHaveLength(1)
  })

  it('asks the server for the view rather than filtering in the browser', async () => {
    renderPage('/tasks?view=unassigned')
    await waitFor(() => expect(requests.tasks.length).toBeGreaterThan(0))
    expect(requests.tasks[0]).toMatchObject({ view: 'unassigned' })
  })
})

describe('view tabs', () => {
  it('shows the counts the server sent, not a count of the rows on screen', async () => {
    renderPage()
    // Only three tasks are loaded, but All says 12 and Done says 7.
    await waitFor(async () => {
      expect(await screen.findByRole('button', { name: /^All/ })).toHaveTextContent('12')
    })
    expect(await screen.findByRole('button', { name: /^Done/ })).toHaveTextContent('7')
    expect(await screen.findByRole('button', { name: /^Unassigned/ })).toHaveTextContent('4')
  })

  it('refetches with the chosen view when a tab is clicked', async () => {
    const actor = userEvent.setup()
    renderPage()
    await actor.click(await screen.findByRole('button', { name: /^My work/ }))
    await waitFor(() => expect(requests.tasks.at(-1)).toMatchObject({ view: 'mine' }))
  })
})

describe('keyboard', () => {
  it('opens the task under the cursor on Enter, after j has moved it', async () => {
    const actor = userEvent.setup()
    renderPage()
    await screen.findByText('Awaiting legal sign-off')

    await actor.keyboard('j{Enter}')
    // Second row in the flattened order is the overdue one.
    expect(await screen.findByRole('dialog', { name: 'Send investor deck' })).toBeInTheDocument()
  })

  it('selects with x, shows the bulk bar, and clears on Escape', async () => {
    const actor = userEvent.setup()
    renderPage()
    await screen.findByText('Awaiting legal sign-off')

    await actor.keyboard('x')
    expect(await screen.findByRole('toolbar', { name: '1 selected' })).toBeInTheDocument()

    await actor.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('toolbar', { name: '1 selected' })).not.toBeInTheDocument())
  })

  it('ignores list shortcuts while the drawer is over the list', async () => {
    const actor = userEvent.setup()
    renderPage('/tasks?open=1')
    await screen.findByRole('dialog', { name: 'Awaiting legal sign-off' })

    // `d` would complete a task if the list were still listening.
    await actor.keyboard('d')
    expect(apiPatch).not.toHaveBeenCalled()
  })
})

describe('inline changes', () => {
  it('patches the task with the status chosen from the row cell', async () => {
    const actor = userEvent.setup()
    renderPage()
    // Exact name, so this is the row's status cell and not the "Blocked 1"
    // group heading above it.
    await actor.click(await screen.findByRole('button', { name: 'Blocked' }))
    await actor.click(await screen.findByRole('menuitem', { name: 'Complete' }))
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/api/tasks/1', expect.objectContaining({ status_value_id: 14 })))
  })

  it('offers the assign affordance on an unowned row and the avatar on an owned one', async () => {
    renderPage()
    expect(await screen.findByRole('button', { name: 'Assigned to Sam Kaur' })).toBeInTheDocument()
    expect((await screen.findAllByRole('button', { name: 'Assign this task' })).length).toBeGreaterThan(0)
  })
})

describe('empty states', () => {
  it('calls an empty Triage the good outcome', async () => {
    listState.tasks = []
    listState.total = 0
    listState.counts = { triage: 0, mine: 0, all: 5, unassigned: 0, done: 5 }
    renderPage()
    expect(await screen.findByText('All clear')).toBeInTheDocument()
  })

  it('blames the filter, not the work, when a filter is what emptied the list', async () => {
    listState.tasks = []
    listState.total = 0
    renderPage('/tasks?urgency_value_id=20')
    expect(await screen.findByText('Nothing matches')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
  })
})
