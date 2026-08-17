import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import type { Timesheet } from '../types/api'
import { TimesheetPage } from './TimesheetPage'

/**
 * The timesheet screen, with the API stubbed.
 *
 * The server decides what a period contains; these cases are about the two
 * things the screen owns — walking periods, and the clipboard.
 */

const state = vi.hoisted(() => ({ data: null as unknown as Timesheet }))
const apiGet = vi.hoisted(() => vi.fn(async () => ({ data: state.data })))
const apiPut = vi.hoisted(() => vi.fn(async () => ({
  data: {
    task_id: 87,
    date: '2026-08-03',
    description: 'Rewired the checkout redirect',
    generated: 'Fixed broken checkout links',
    edited: true,
    minutes: 95,
    hours: 1.58,
    task_title: 'Fix broken checkout links',
  },
})))
const written = vi.hoisted(() => ({ text: '' }))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, api: { ...actual.api, get: apiGet, put: apiPut } }
})

function timesheet(overrides: Partial<Timesheet> = {}): Timesheet {
  return {
    cutoff: 'semi',
    offset: 0,
    period: { start: '2026-08-01', end: '2026-08-15', label: 'Aug 1 – 15, 2026' },
    total_minutes: 155,
    entry_count: 2,
    days_worked: 2,
    unassigned_minutes: 0,
    lanes: [
      {
        client_id: 4,
        client: 'Northwind Creative',
        minutes: 155,
        entry_count: 2,
        rows: [
          {
            task_id: 87,
            date: '2026-08-03',
            description: 'Fixed broken checkout links',
            generated: 'Fixed broken checkout links',
            edited: false,
            minutes: 95,
            hours: 1.58,
            task_title: 'Fix broken checkout links',
          },
          {
            task_id: 88,
            date: '2026-08-04',
            description: 'Drafted the launch copy',
            generated: 'Drafted the launch copy',
            edited: false,
            minutes: 60,
            hours: 1,
            task_title: 'Draft the launch copy',
          },
        ],
      },
    ],
    ...overrides,
  }
}

function renderPage(entry = '/timesheet') {
  return render(<MemoryRouter initialEntries={[entry]}><TimesheetPage /></MemoryRouter>)
}

// Defined once: `navigator.clipboard` is read-only, so re-assigning it per
// test throws and takes the whole setup down with it.
Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: { writeText: async (text: string) => { written.text = text } },
})

beforeEach(() => {
  state.data = timesheet()
  written.text = ''
  apiGet.mockClear()
  apiPut.mockClear()
})

it('summarises the period in entries, hours and days worked', async () => {
  renderPage()

  expect(await screen.findByText('2 entries · 2h 35m · 2 days worked')).toBeInTheDocument()
  expect(screen.getByText('Aug 1 – 15, 2026')).toBeInTheDocument()
})

it('walks to the previous period without re-deriving it in the browser', async () => {
  const actor = userEvent.setup()
  renderPage()
  await screen.findByText('Aug 1 – 15, 2026')

  await actor.click(screen.getByRole('button', { name: 'Previous period' }))

  await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith('/api/timesheet', { cutoff: 'semi', offset: -1 }, expect.anything()))
})

it('returns to the current period when the cut-off changes, since an offset means something else', async () => {
  const actor = userEvent.setup()
  renderPage('/timesheet?offset=-3')
  await screen.findByText('Aug 1 – 15, 2026')

  await actor.click(screen.getByRole('radio', { name: 'Monthly' }))

  await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith('/api/timesheet', { cutoff: 'month', offset: 0 }, expect.anything()))
})

it('puts the four tab-separated columns on the clipboard', async () => {
  const actor = userEvent.setup()
  // `userEvent.setup()` installs a clipboard of its own, so the capture has to
  // go back on after it rather than before.
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text: string) => { written.text = text } },
  })
  renderPage()
  await screen.findByText('Aug 1 – 15, 2026')

  await actor.click(screen.getByRole('button', { name: /Copy 2 rows/ }))

  await waitFor(() => expect(written.text).toBe(
    'Northwind Creative\t8-3\tFixed broken checkout links\t1.58\n'
    + 'Northwind Creative\t8-4\tDrafted the launch copy\t1',
  ))
})

it('refuses to copy an empty period rather than putting nothing on the clipboard', async () => {
  state.data = timesheet({ lanes: [], entry_count: 0, total_minutes: 0, days_worked: 0 })
  renderPage()

  expect(await screen.findByText('Nothing tracked in this period')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Nothing to copy' })).toBeDisabled()
})

it('saves an edited description against the task and the day', async () => {
  const actor = userEvent.setup()
  renderPage()

  await actor.click(await screen.findByRole('button', { name: 'Fixed broken checkout links' }))
  const field = screen.getByRole('textbox')
  await actor.clear(field)
  await actor.type(field, 'Rewired the checkout redirect{Enter}')

  await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/timesheet/description', {
    task_id: 87,
    date: '2026-08-03',
    body: 'Rewired the checkout redirect',
  }))
  expect(await screen.findByRole('button', { name: 'Rewired the checkout redirect' })).toBeInTheDocument()
})

it('leaves the row alone when an edit is abandoned', async () => {
  const actor = userEvent.setup()
  renderPage()

  await actor.click(await screen.findByRole('button', { name: 'Drafted the launch copy' }))
  await actor.type(screen.getByRole('textbox'), ' and sent it{Escape}')

  expect(apiPut).not.toHaveBeenCalled()
  expect(await screen.findByRole('button', { name: 'Drafted the launch copy' })).toBeInTheDocument()
})

it('admits to time that has no task rather than hiding it', async () => {
  state.data = timesheet({ unassigned_minutes: 45 })
  renderPage()

  expect(await screen.findByText(/45m tracked without a task is not in these rows/)).toBeInTheDocument()
})


/**
 * The row that used to be missing entirely: work somebody finished without a
 * timer running. It has to look like a cell wanting a number, not like a
 * rendering fault, and typing into it has to reach the server.
 */
it('shows finished work with no time as a cell waiting to be filled', async () => {
  state.data = timesheet({
    total_minutes: 0,
    entry_count: 1,
    lanes: [
      {
        client_id: 4,
        client: 'Northwind Creative',
        minutes: 0,
        entry_count: 1,
        rows: [
          {
            task_id: 87,
            date: '2026-08-05',
            description: 'Fixed broken checkout links',
            generated: 'Fixed broken checkout links',
            edited: false,
            minutes: null,
            hours: null,
            tracked_minutes: null,
            needs_hours: true,
            typed: false,
            task_title: 'Fix broken checkout links',
          },
        ],
      },
    ],
  })
  const actor = userEvent.setup()
  renderPage()

  const cell = await screen.findByRole('button', { name: 'Add' })
  await actor.click(cell)
  await actor.type(screen.getByLabelText('Hours for Fix broken checkout links on 2026-08-05'), '1.5{Enter}')

  await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/api/timesheet/hours', {
    task_id: 87,
    date: '2026-08-05',
    minutes: 90,
  }))
})
