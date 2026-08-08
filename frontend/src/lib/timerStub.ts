import { vi } from 'vitest'
import type { Timer } from './useTimer'

/**
 * An idle timer for tests that render a page rather than the shell.
 *
 * The pages read the timer through a context the shell provides, so a test
 * mounting a page on its own has to stand one in. Override only what the test
 * is about — a test for the drawer's timer button should not have to describe
 * ten empty hour buckets to get there.
 */
export function stubTimer(overrides: Partial<Timer> = {}): Timer {
  return {
    state: 'idle',
    clockedIn: false,
    busy: false,
    loading: false,
    task: null,
    breakKind: null,
    seconds: 0,
    pausedSeconds: 0,
    todayMinutes: 0,
    breakDueAt: null,
    overBy: 0,
    hours: Array.from({ length: 10 }, (_, index) => ({
      hour: 9 + index,
      workMinutes: 0,
      breakMinutes: 0,
      live: false,
    })),
    breakMenuOpen: false,
    setBreakMenuOpen: vi.fn(),
    start: vi.fn(async () => undefined),
    takeBreak: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    stop: vi.fn(async () => null),
    refresh: vi.fn(async () => undefined),
    ...overrides,
  }
}
