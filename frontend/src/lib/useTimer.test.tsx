import { act, render, screen, waitFor } from '@testing-library/react'
import type { TimerStatus } from '../types/api'
import { TimerProvider, useTimerContext } from './useTimer'

/**
 * What the timer derives, rather than what it stores.
 *
 * The one rule worth protecting is that elapsed time is a function of the
 * server's `started_at` and the current clock. A timer that counted up in
 * state would look identical on screen and would silently reset every reload,
 * which is exactly the failure the phase is meant to rule out.
 */

const status = vi.hoisted(() => ({ value: null as unknown as TimerStatus }))
const apiGet = vi.hoisted(() => vi.fn(async () => ({ data: status.value })))
// Typed loosely because `stop` answers with a status *plus* what it logged.
const apiPost = vi.hoisted(() => vi.fn(async (): Promise<{ data: unknown }> => ({ data: status.value })))

vi.mock('../auth/WorkspaceProvider', () => ({
  useWorkspace: () => ({ refresh: vi.fn() }),
}))

vi.mock('./permissions', () => ({ useCan: () => () => true }))

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return { ...actual, api: { ...actual.api, get: apiGet, post: apiPost } }
})

function timerStatus(overrides: Partial<TimerStatus> = {}): TimerStatus {
  return {
    entry: null,
    paused_task: null,
    paused_seconds: 0,
    clocked_in: false,
    today: { work_minutes: 0, break_minutes: 0, hours: [] },
    week: [],
    ...overrides,
  }
}

function secondsAgo(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString()
}

/** Prints the derived values a test cares about, so assertions read as text. */
function Probe() {
  const timer = useTimerContext()
  const live = timer.hours.find((hour) => hour.live)
  return (
    <dl>
      <dd data-testid="state">{timer.state}</dd>
      <dd data-testid="seconds">{timer.seconds}</dd>
      <dd data-testid="over">{timer.overBy}</dd>
      <dd data-testid="today">{Math.round(timer.todayMinutes)}</dd>
      <dd data-testid="live-hour">{live ? Math.round(live.workMinutes) : 'none'}</dd>
    </dl>
  )
}

function renderTimer() {
  return render(<TimerProvider><Probe /></TimerProvider>)
}

beforeEach(() => {
  status.value = timerStatus()
  apiGet.mockClear()
  apiPost.mockClear()
})

it('reads elapsed time from the server clock rather than counting up from zero', async () => {
  // A tab opened 25 minutes into a run — the state a reload lands in.
  status.value = timerStatus({
    clocked_in: true,
    entry: {
      id: 1,
      task_id: 7,
      task: { id: 7, title: 'Cut the launch film' },
      kind: 'work',
      break_kind: null,
      break_due_minutes: null,
      started_at: secondsAgo(1500),
    },
  })

  renderTimer()

  await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('working'))
  expect(Number(screen.getByTestId('seconds').textContent)).toBeGreaterThanOrEqual(1500)
})

it('reports how far past its expected end an overrunning break is', async () => {
  status.value = timerStatus({
    clocked_in: true,
    paused_task: { id: 7, title: 'Cut the launch film' },
    paused_seconds: 1500,
    entry: {
      id: 2,
      task_id: 7,
      task: { id: 7, title: 'Cut the launch film' },
      kind: 'break',
      break_kind: 'Lunch',
      break_due_minutes: 45,
      started_at: secondsAgo(50 * 60),
    },
  })

  renderTimer()

  await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('break'))
  expect(screen.getByTestId('over')).toHaveTextContent('5')
})

it('leaves an open-ended break with nothing to be late for', async () => {
  status.value = timerStatus({
    clocked_in: true,
    entry: {
      id: 3,
      task_id: null,
      task: null,
      kind: 'break',
      break_kind: 'Open-ended',
      break_due_minutes: 0,
      started_at: secondsAgo(3 * 60 * 60),
    },
  })

  renderTimer()

  await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('break'))
  expect(screen.getByTestId('over')).toHaveTextContent('0')
})

it('adds the run in progress to the day total and to the hour it is in', async () => {
  const hour = new Date().getHours()
  status.value = timerStatus({
    clocked_in: true,
    entry: {
      id: 4,
      task_id: 7,
      task: { id: 7, title: 'Cut the launch film' },
      kind: 'work',
      break_kind: null,
      break_due_minutes: null,
      started_at: secondsAgo(600),
    },
    today: {
      work_minutes: 120,
      break_minutes: 0,
      // The server's own count of the current hour, which the client tops up.
      hours: [{ hour: Math.min(18, Math.max(9, hour)), work_minutes: 4, break_minutes: 0 }],
    },
  })

  renderTimer()

  await waitFor(() => expect(screen.getByTestId('today')).toHaveTextContent('130'))
  expect(screen.getByTestId('live-hour')).toHaveTextContent('14')
})

it('hands back what was logged so the stop can be announced', async () => {
  status.value = timerStatus({
    clocked_in: true,
    entry: {
      id: 5,
      task_id: 7,
      task: { id: 7, title: 'Cut the launch film' },
      kind: 'work',
      break_kind: null,
      break_due_minutes: null,
      started_at: secondsAgo(600),
    },
  })

  let logged: { minutes: number; task: { title: string } | null } | null = null
  function StopProbe() {
    const timer = useTimerContext()
    return <button onClick={async () => { logged = await timer.stop() }}>stop</button>
  }
  render(<TimerProvider><StopProbe /></TimerProvider>)

  apiPost.mockResolvedValueOnce({
    data: { ...timerStatus({ clocked_in: true }), logged: { minutes: 10, task: { id: 7, title: 'Cut the launch film' } } },
  })

  await act(async () => { screen.getByRole('button').click() })

  await waitFor(() => expect(logged).toEqual({ minutes: 10, task: { id: 7, title: 'Cut the launch film' } }))
  expect(apiPost).toHaveBeenCalledWith('/api/time/timer/stop', undefined)
})
