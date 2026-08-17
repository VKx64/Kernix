import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import type { Dashboard } from '../types/api'
import { DashboardPage } from './DashboardPage'

/**
 * The landing screen, with the API stubbed.
 *
 * The server owns every number here, so these cases are about what the screen
 * does with them: which range it asks for, what it renders when a section is
 * empty, and the two panels that disappear entirely rather than showing zero.
 */

const state = vi.hoisted(() => ({ data: null as unknown as Dashboard }))
const apiGet = vi.hoisted(() => vi.fn(async () => ({ data: state.data })))

// The approval queue fetches its own data and reads the signed-in role to
// decide whether to render at all. It is covered by its own test file; here it
// would only drag the auth context into cases that are about the dashboard's
// numbers.
vi.mock('@/components/dashboard/WorkRequestInbox', () => ({ WorkRequestInbox: () => null }))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, api: { ...actual.api, get: apiGet } }
})

function dashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  return {
    range: 'today',
    date: '2026-08-08',
    greeting_name: 'Maria',
    metrics: {
      due_today: { count: 3, note: '2 not started' },
      overdue: { count: 2, note: 'oldest 4 days late' },
      tracked_today: { minutes: 312, note: 'of 7h target' },
      retainer_burn: { percent: 68, note: 'across 3 clients' },
    },
    focus: [
      {
        rank: 1,
        id: 12,
        title: 'Send the investor deck',
        project: 'Investor Deck',
        client: 'Anchor & Co.',
        status: { label: 'In progress', role: 'active' },
        urgency: { label: 'High', rank: 1 },
        due_date: '2026-08-06',
        logged_minutes: 90,
        overdue: true,
      },
    ],
    needs_attention: [
      {
        id: 8,
        title: 'Awaiting legal sign-off',
        project: 'SEO Overhaul',
        why: 'Blocked for 3 days',
        reason: 'blocked',
        status: { label: 'Blocked', role: 'blocked' },
        urgency: { label: 'Normal', rank: 2 },
        due_date: null,
      },
    ],
    upcoming: [
      {
        date: '2026-08-09',
        label: 'Tomorrow',
        tasks: [{ id: 5, title: 'Ship the ad creatives', project: 'Q3 Social Campaign' }],
      },
    ],
    week: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, index) => ({
      date: `2026-08-0${index + 3}`,
      label,
      work_minutes: index < 4 ? 400 : 0,
      break_minutes: index < 4 ? 30 : 0,
      is_today: index === 4,
    })),
    week_total_minutes: 1600,
    last_week_total_minutes: 1780,
    daily_target_minutes: 420,
    retainer: {
      month_label: 'August',
      capacity_minutes: 18000,
      used_minutes: 12240,
      projected_minutes: 19100,
      day_of_month: 8,
      days_in_month: 31,
      series: [
        { day: 1, used_minutes: 600 },
        { day: 8, used_minutes: 12240 },
      ],
      clients: [{ id: 4, name: 'Northwind Creative', used_minutes: 3400, retainer_minutes: 4800 }],
    },
    activity: [
      { id: 91, user: { id: 3, first_name: 'Liam', last_name: 'Cruz' }, text: 'Liam commented on Ship the ad creatives', at: new Date().toISOString() },
    ],
    ...overrides,
  }
}

function renderPage(entry = '/') {
  return render(<MemoryRouter initialEntries={[entry]}><DashboardPage /></MemoryRouter>)
}

beforeEach(() => {
  state.data = dashboard()
  apiGet.mockClear()
})

it('greets by name and summarises the day beside the date', async () => {
  renderPage()

  expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/Good (morning|afternoon|evening), Maria/)
  expect(screen.getByText(/3 due today · 2 overdue/)).toBeInTheDocument()
})

it('ranks the focus list and shows what each row already cost', async () => {
  renderPage()

  expect(await screen.findByText('Send the investor deck')).toBeInTheDocument()
  expect(screen.getByText('01')).toBeInTheDocument()
  expect(screen.getByText(/Investor Deck · in progress · 1h 30m logged/)).toBeInTheDocument()
})

it('asks the server for the week rather than re-filtering what it already has', async () => {
  const actor = userEvent.setup()
  renderPage()
  await screen.findByText('Send the investor deck')

  await actor.click(screen.getByRole('radio', { name: 'This week' }))

  await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith('/api/dashboard', { range: 'week' }, expect.anything()))
})

it('says why a task needs attention rather than only that it does', async () => {
  renderPage()

  expect(await screen.findByText('Awaiting legal sign-off')).toBeInTheDocument()
  expect(screen.getByText('Blocked for 3 days')).toBeInTheDocument()
})

it('drops the retainer panel and its tile when no client has an allowance', async () => {
  state.data = dashboard({ retainer: null, metrics: { ...dashboard().metrics, retainer_burn: null } })
  renderPage()

  await screen.findByText('Send the investor deck')
  expect(screen.queryByText('Retainer burn')).not.toBeInTheDocument()
})

it('reports the week against the one before it', async () => {
  renderPage()

  expect(await screen.findByText('vs last week')).toBeInTheDocument()
  // 1600 tracked against 1780 last week — down 3 hours, and shown as a loss.
  expect(screen.getByText('−3h')).toBeInTheDocument()
})

it('keeps quiet rather than alarming when a section is empty', async () => {
  state.data = dashboard({ focus: [], needs_attention: [], upcoming: [] })
  renderPage()

  expect(await screen.findByText('Nothing is waiting on you.')).toBeInTheDocument()
  expect(screen.getByText('Nothing is late, blocked or untouched.')).toBeInTheDocument()
})

it('leaves the daily brief out until there is something to write it', async () => {
  renderPage()

  await screen.findByText('Send the investor deck')
  expect(screen.queryByText(/Daily brief/i)).not.toBeInTheDocument()
})
