import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { ClientDetailPage } from './ClientDetailPage'
import { ProjectDetailPage } from './ProjectDetailPage'

/**
 * The two pages behind a card.
 *
 * The server derives every number, so what is pinned here is the editorial
 * layer: which figure a tile reports, and the several places a panel is meant
 * to disappear rather than show a misleading zero.
 */

const payload = vi.hoisted(() => ({ data: {} as Record<string, unknown> }))
const apiGet = vi.hoisted(() => vi.fn(async () => ({ data: payload.data })))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, api: { ...actual.api, get: apiGet } }
})

vi.mock('../lib/permissions', () => ({ useCan: () => () => true, isAdministrator: () => false }))

function projectPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'Website Relaunch',
    client: { id: 4, name: 'Northwind Creative' },
    stats: {
      total: 8, done: 1, open: 7, overdue: 2, blocked: 2, unowned: 1,
      logged_minutes: 265, estimated_minutes: 580, budget_minutes: 4800,
      percent_complete: 13, health: 'offtrack',
    },
    open_tasks: [
      {
        id: 12,
        title: 'Fix broken checkout links',
        status: { label: 'In progress', role: 'active' },
        urgency: { label: 'High', rank: 1 },
        due_date: '2026-08-07',
        assignee: { id: 2, first_name: 'Maria', last_name: 'Santos' },
      },
    ],
    team: [
      { id: 1, first_name: 'Admin', last_name: 'User', open_tasks: 1, logged_minutes: 40, is_manager: true },
      { id: 2, first_name: 'Maria', last_name: 'Santos', open_tasks: 2, logged_minutes: 120, is_manager: false },
    ],
    activity: [],
    ...overrides,
  }
}

function clientPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 4,
    name: 'Northwind Creative',
    website: 'northwind.example',
    stats: {
      projects: 2, open_tasks: 12, overdue: 4, blocked: 3, logged_minutes: 573,
      retainer_minutes: 4800, retainer_used_minutes: 2550, health: 'offtrack',
      owner: { id: 1, first_name: 'Admin', last_name: 'User' },
    },
    projects: [
      {
        id: 2,
        name: 'Q3 Social Campaign',
        stats: {
          total: 6, done: 1, open: 5, overdue: 2, blocked: 1, unowned: 0,
          logged_minutes: 308, estimated_minutes: 480, budget_minutes: 2400,
          percent_complete: 17, health: 'atrisk',
        },
      },
    ],
    contacts: [],
    activity: [],
    ...overrides,
  }
}

function renderProject() {
  return render(
    <MemoryRouter initialEntries={['/projects/1']}>
      <Routes><Route path="/projects/:projectId" element={<ProjectDetailPage />} /></Routes>
    </MemoryRouter>,
  )
}

function renderClient() {
  return render(
    <MemoryRouter initialEntries={['/clients/4']}>
      <Routes><Route path="/clients/:clientId" element={<ClientDetailPage />} /></Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => { apiGet.mockClear() })

describe('project detail', () => {
  it('leads with the four figures that decide whether to worry', async () => {
    payload.data = projectPayload()
    renderProject()

    expect(await screen.findByText('Website Relaunch')).toBeInTheDocument()
    expect(screen.getByText('Off track')).toBeInTheDocument()
    expect(screen.getByText('2 overdue · 2 blocked')).toBeInTheDocument()
    expect(screen.getByText('1 of 8 done')).toBeInTheDocument()
    expect(screen.getByText('1 unassigned')).toBeInTheDocument()
    expect(screen.getByText('of 80h budget')).toBeInTheDocument()
  })

  it('falls back to the estimate when a project carries no budget', async () => {
    payload.data = projectPayload({
      stats: { ...projectPayload().stats as object, budget_minutes: null },
    })
    renderProject()

    // An estimate is what the work was expected to take; a budget is what it
    // was sold as. With no budget, saying nothing would waste the line.
    expect(await screen.findByText('9h 40m estimated')).toBeInTheDocument()
    expect(screen.queryByText(/budget/)).not.toBeInTheDocument()
  })

  it('marks who runs the project rather than just listing faces', async () => {
    payload.data = projectPayload()
    renderProject()

    expect(await screen.findByText('Project manager')).toBeInTheDocument()
    expect(screen.getByText('Maria Santos')).toBeInTheDocument()
  })

  it('says the panel is empty rather than rendering an empty panel', async () => {
    payload.data = projectPayload({ open_tasks: [], team: [] })
    renderProject()

    expect(await screen.findByText('Nothing open on this project.')).toBeInTheDocument()
    expect(screen.getByText('Nobody is assigned yet.')).toBeInTheDocument()
    expect(screen.getByText('Nothing has happened yet.')).toBeInTheDocument()
  })
})

describe('client detail', () => {
  it('reports the retainer as this month and the tracked total as all time', async () => {
    payload.data = clientPayload()
    renderClient()

    expect(await screen.findByText('Northwind Creative')).toBeInTheDocument()
    expect(screen.getByText('42h 30m of 80h this month')).toBeInTheDocument()
    expect(screen.getByText('all time')).toBeInTheDocument()
  })

  it('drops the retainer tile entirely for a client with no allowance', async () => {
    payload.data = clientPayload({
      stats: { ...clientPayload().stats as object, retainer_minutes: null, retainer_used_minutes: null },
    })
    renderClient()

    expect(await screen.findByText('Northwind Creative')).toBeInTheDocument()
    expect(screen.queryByText('Retainer')).not.toBeInTheDocument()
  })

  it('shows the client’s projects as the cards they already are', async () => {
    payload.data = clientPayload()
    renderClient()

    expect(await screen.findByText('Q3 Social Campaign')).toBeInTheDocument()
    expect(screen.getByText('At risk')).toBeInTheDocument()
  })

  it('never mentions money anywhere on the page', async () => {
    payload.data = clientPayload()
    renderClient()

    await screen.findByText('Northwind Creative')
    expect(screen.queryByText(/outstanding|invoice|\$/i)).not.toBeInTheDocument()
  })
})
