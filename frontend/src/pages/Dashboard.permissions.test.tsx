import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { DashboardPage } from './DashboardPage'
import type { User } from '../types/api'

const authState = vi.hoisted(() => ({ user: null as User | null }))
const dashboardState = vi.hoisted(() => ({ payload: {} as Record<string, unknown> }))
const apiGet = vi.hoisted(() => vi.fn(async () => ({ data: dashboardState.payload })))

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: authState.user, status: 'authenticated', login: vi.fn(), logout: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, api: { ...actual.api, get: apiGet } }
})

function renderDashboard(permissions: string[]) {
  authState.user = { id: 7, username: 'viewer', first_name: 'Dash', permissions }
  return render(<MemoryRouter><DashboardPage /></MemoryRouter>)
}

describe('dashboard redaction', () => {
  beforeEach(() => {
    apiGet.mockClear()
    dashboardState.payload = {
      counts: {},
      today_minutes: 30,
      range_minutes: 90,
      entries: [],
      project_chart: [{ name: 'Secret project', minutes: 60 }],
      client_chart: [{ name: 'Visible client', minutes: 30 }],
      team_time: {
        clocked_in_count: 1,
        working_count: 1,
        on_break_count: 0,
        sessions: [{ id: 8, state: 'working', clock_in_at: '2026-07-14T01:00:00Z', user: { id: 8, first_name: 'Taylor', last_name: 'Team' } }],
      },
    }
  })

  it('shows team time and the permitted client chart without rendering the project panel', async () => {
    renderDashboard(['dashboard.view', 'tasks.view', 'time.track', 'time.view_team', 'clients.view'])

    expect(await screen.findByText('Team time now')).toBeInTheDocument()
    expect(screen.getByText('Taylor Team')).toBeInTheDocument()
    expect(screen.getByText('Time by client')).toBeInTheDocument()
    expect(screen.queryByText('Time by project')).not.toBeInTheDocument()
    expect(screen.queryByText('Secret project')).not.toBeInTheDocument()
  })

  it('hides team and client panels when only project summaries are permitted', async () => {
    renderDashboard(['dashboard.view', 'tasks.view', 'time.track', 'projects.view'])

    expect(await screen.findByText('Time by project')).toBeInTheDocument()
    expect(screen.queryByText('Time by client')).not.toBeInTheDocument()
    expect(screen.queryByText('Team time now')).not.toBeInTheDocument()
  })
})
