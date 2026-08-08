import {
  dueMeta,
  formatMinutes,
  railColor,
  statusColor,
  statusRole,
  subtaskProgress,
  taskMetaParts,
  urgencyColor,
  urgencyRank,
} from './taskSignals'
import type { FieldValue, Task } from '../types/api'

/**
 * The whole point of this module is that nothing keys on a workspace's own
 * wording. These cases pin both halves of that: the server-sent role or rank
 * wins, and an unmapped value still lands somewhere sensible rather than
 * vanishing from a bucket.
 */
function status(overrides: Partial<FieldValue> = {}): FieldValue {
  return { id: 1, label: 'Whatever', ...overrides }
}

describe('statusRole', () => {
  it('trusts the role the server resolved over the slug', () => {
    // A workspace renamed its slug but the server still knows what it means.
    expect(statusRole(status({ key: 'signed_off', role: 'done' }))).toBe('done')
  })

  it('falls back to the canonical slug map when no role is sent', () => {
    expect(statusRole(status({ key: 'quality_check' }))).toBe('review')
    expect(statusRole(status({ key: 'needs_correction' }))).toBe('blocked')
    expect(statusRole(status({ key: 'complete' }))).toBe('done')
  })

  it('reads a bare slug string, not just a value object', () => {
    expect(statusRole('in_progress')).toBe('active')
  })

  it('treats an unmapped status as open work rather than dropping it', () => {
    expect(statusRole(status({ key: 'awaiting_legal' }))).toBe('open')
    expect(statusRole(null)).toBe('open')
    expect(statusRole(undefined)).toBe('open')
  })
})

describe('urgencyRank', () => {
  it('trusts the rank the server resolved over the slug', () => {
    expect(urgencyRank(status({ key: 'showstopper', rank: 0 }))).toBe(0)
  })

  it('falls back to the canonical slug map', () => {
    expect(urgencyRank(status({ key: 'urgent' }))).toBe(0)
    expect(urgencyRank(status({ key: 'low' }))).toBe(3)
  })

  it('puts an unmapped urgency mid-scale so it neither shouts nor hides', () => {
    expect(urgencyRank(status({ key: 'whenever' }))).toBe(2)
    expect(urgencyRank(null)).toBe(2)
  })
})

describe('colour resolution', () => {
  it('prefers the colour the workspace configured', () => {
    expect(statusColor(status({ key: 'blocked', color: '#123456' }))).toBe('#123456')
    expect(urgencyColor(status({ key: 'urgent', color: '#654321' }))).toBe('#654321')
  })

  it('falls back to the role or rank colour when none is configured', () => {
    expect(statusColor(status({ key: 'blocked' }))).toBe('var(--danger)')
    expect(statusColor(status({ key: 'in_progress' }))).toBe('var(--brand)')
    expect(urgencyColor(status({ key: 'urgent' }))).toBe('var(--danger)')
    expect(urgencyColor(status({ key: 'low' }))).toBe('var(--t6)')
  })
})

describe('railColor', () => {
  it('colours the rail only for the two ranks worth interrupting for', () => {
    expect(railColor(status({ key: 'urgent' }))).toBe('var(--danger)')
    expect(railColor(status({ key: 'high' }))).toBe('var(--warn)')
    expect(railColor(status({ key: 'normal' }))).toBeNull()
    expect(railColor(status({ key: 'low' }))).toBeNull()
  })

  it('drops the rail once the task is done, however urgent it was', () => {
    expect(railColor(status({ key: 'urgent' }), true)).toBeNull()
  })
})

describe('dueMeta', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // A Wednesday, so the weekday label below is unambiguous.
    vi.setSystemTime(new Date(2026, 7, 5, 9, 0, 0))
  })
  afterEach(() => vi.useRealTimers())

  it('shows an em dash with no tone when there is no date', () => {
    expect(dueMeta(null)).toMatchObject({ label: '—', tone: 'none' })
  })

  it('counts days for anything late', () => {
    expect(dueMeta('2026-08-02')).toMatchObject({ label: '3d late', tone: 'over' })
    expect(dueMeta('2026-08-04')).toMatchObject({ label: '1d late', tone: 'over' })
  })

  it('names today and tomorrow rather than dating them', () => {
    expect(dueMeta('2026-08-05')).toMatchObject({ label: 'Today', tone: 'today' })
    expect(dueMeta('2026-08-06')).toMatchObject({ label: 'Tomorrow', tone: 'soon' })
  })

  it('uses the weekday inside the week and a date beyond it', () => {
    expect(dueMeta('2026-08-09')).toMatchObject({ tone: 'soon' })
    expect(dueMeta('2026-08-09').label).toMatch(/^[A-Z][a-z]{2}$/)
    expect(dueMeta('2026-08-25')).toMatchObject({ tone: 'later' })
    expect(dueMeta('2026-08-25').label).toContain('25')
  })

  it('ignores a time component on the date', () => {
    expect(dueMeta('2026-08-05T23:30:00Z')).toMatchObject({ label: 'Today' })
  })
})

describe('formatMinutes', () => {
  it('says nothing at all rather than 0m, which is noise in a row', () => {
    expect(formatMinutes(0)).toBe('')
    expect(formatMinutes(null)).toBe('')
  })

  it('drops the empty half of the duration', () => {
    expect(formatMinutes(45)).toBe('45m')
    expect(formatMinutes(60)).toBe('1h')
    expect(formatMinutes(260)).toBe('4h 20m')
  })
})

describe('subtaskProgress', () => {
  it('counts the rows when the detail payload carries them', () => {
    const task = {
      id: 1,
      title: 'x',
      subtasks: [
        { id: 1, title: 'a', completed_at: '2026-08-01' },
        { id: 2, title: 'b' },
        { id: 3, title: 'c' },
      ],
    } as Task
    expect(subtaskProgress(task)).toEqual({ total: 3, done: 1 })
  })

  it('falls back to the counts the list payload sends instead of the rows', () => {
    const task = { id: 1, title: 'x', subtasks_count: 4, completed_subtasks_count: 3 } as unknown as Task
    expect(subtaskProgress(task)).toEqual({ total: 4, done: 3 })
  })

  it('reports nothing for a task with no steps', () => {
    expect(subtaskProgress({ id: 1, title: 'x' } as Task)).toEqual({ total: 0, done: 0 })
  })
})

describe('taskMetaParts', () => {
  it('includes only the parts the task actually has', () => {
    const bare = { id: 1, title: 'x', project: { id: 2, name: 'Launch' } } as Task
    expect(taskMetaParts(bare)).toEqual(['Launch'])
  })

  it('adds checklist progress, logged time and the blocked flag', () => {
    const task = {
      id: 1,
      title: 'x',
      project: { id: 2, name: 'Launch' },
      subtasks_count: 3,
      completed_subtasks_count: 1,
      actual_minutes: 95,
      status_value: { id: 9, key: 'blocked', label: 'Blocked' },
    } as unknown as Task
    expect(taskMetaParts(task)).toEqual(['Launch', '1/3', '1h 35m', 'blocked'])
  })
})
