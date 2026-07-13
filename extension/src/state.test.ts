import { describe, expect, it } from 'vitest'
import { badgeForState, elapsedSeconds, formatDuration } from './state'

describe('work-state presentation', () => {
  it('uses the agreed working, break, clocked-out, and stale badges', () => {
    expect(badgeForState('working').text).toBe('ON')
    expect(badgeForState('working').title).toBe('Kernix · Working')
    expect(badgeForState('break').text).toBe('BRK')
    expect(badgeForState('clocked_out').text).toBe('')
    expect(badgeForState('stale').text).toBe('?')
  })

  it('subtracts completed and open breaks from elapsed work time', () => {
    const now = new Date('2026-07-14T10:00:00Z').getTime()
    expect(elapsedSeconds({
      state: 'break',
      today_minutes: 0,
      can_mutate_tasks: true,
      session: {
        id: 1,
        clock_in_at: '2026-07-14T08:00:00Z',
        breaks: [
          { start_at: '2026-07-14T08:30:00Z', end_at: '2026-07-14T08:45:00Z' },
          { start_at: '2026-07-14T09:45:00Z', end_at: null },
        ],
      },
    }, now)).toBe(5400)
    expect(formatDuration(5400)).toBe('01:30:00')
  })
})
