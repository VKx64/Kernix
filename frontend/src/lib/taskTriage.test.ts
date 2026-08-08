import { flatTaskIds, groupTasks, needsTriage, sortTasks, type TaskGroup } from './taskTriage'
import type { FieldValue, Task, UserSummary } from '../types/api'

const STATUSES: FieldValue[] = [
  { id: 10, key: 'pending', label: 'Pending' },
  { id: 11, key: 'in_progress', label: 'In progress' },
  { id: 12, key: 'quality_check', label: 'Quality check' },
  { id: 13, key: 'blocked', label: 'Blocked' },
  { id: 14, key: 'complete', label: 'Complete' },
]
const URGENCIES: FieldValue[] = [
  { id: 20, key: 'urgent', label: 'Urgent' },
  { id: 21, key: 'high', label: 'High' },
  { id: 22, key: 'normal', label: 'Normal' },
  { id: 23, key: 'low', label: 'Low' },
]
const PEOPLE: UserSummary[] = [
  { id: 1, first_name: 'Sam', last_name: 'Kaur' },
  { id: 2, first_name: 'Jordan', last_name: 'Meyer' },
]

const NOW = new Date(2026, 7, 5, 9, 0, 0)

function iso(dayOffset: number): string {
  const date = new Date(NOW)
  date.setDate(date.getDate() + dayOffset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

let sequence = 0

function task(overrides: Partial<Task> & { statusKey?: string; urgencyKey?: string; due?: number | null } = {}): Task {
  const { statusKey = 'pending', urgencyKey = 'normal', due = null, ...rest } = overrides
  sequence += 1
  return {
    id: rest.id ?? sequence,
    title: rest.title ?? `Task ${sequence}`,
    status_value: STATUSES.find((option) => option.key === statusKey),
    urgency_value: URGENCIES.find((option) => option.key === urgencyKey),
    due_date: due === null ? null : iso(due),
    ...rest,
  } as Task
}

function context() {
  return { statusOptions: STATUSES, urgencyOptions: URGENCIES, people: PEOPLE, now: NOW }
}

function total(groups: TaskGroup[]): number {
  return groups.reduce((sum, group) => sum + group.tasks.length, 0)
}

beforeEach(() => { sequence = 0 })

describe('needsTriage', () => {
  it('claims anything blocked or in review, whatever its date', () => {
    expect(needsTriage(task({ statusKey: 'blocked', due: 30 }), NOW)).toBe(true)
    expect(needsTriage(task({ statusKey: 'quality_check', due: 30 }), NOW)).toBe(true)
  })

  it('claims work that is late or due today', () => {
    expect(needsTriage(task({ due: -2 }), NOW)).toBe(true)
    expect(needsTriage(task({ due: 0 }), NOW)).toBe(true)
  })

  it('claims urgent work with nobody on it', () => {
    expect(needsTriage(task({ urgencyKey: 'urgent', due: 30 }), NOW)).toBe(true)
    expect(needsTriage(task({ urgencyKey: 'high', due: 30 }), NOW)).toBe(true)
  })

  it('leaves urgent work alone once it has an owner', () => {
    expect(needsTriage(task({ urgencyKey: 'urgent', due: 30, assignee: PEOPLE[0] }), NOW)).toBe(false)
  })

  it('ignores calm future work and anything already done', () => {
    expect(needsTriage(task({ due: 12, assignee: PEOPLE[0] }), NOW)).toBe(false)
    expect(needsTriage(task({ statusKey: 'complete', due: -5 }), NOW)).toBe(false)
  })
})

describe('groupTasks by attention', () => {
  it('reports a task that is both blocked and overdue once, under Blocked', () => {
    const both = task({ statusKey: 'blocked', due: -4, title: 'Awaiting sign-off' })
    const groups = groupTasks([both], 'smart', context())
    const holding = groups.filter((group) => group.tasks.length)
    expect(holding).toHaveLength(1)
    expect(holding[0].label).toBe('Blocked')
  })

  it('loses and duplicates nothing, whatever the mix', () => {
    const tasks = [
      task({ statusKey: 'blocked', due: -4 }),
      task({ due: -1 }),
      task({ due: 0 }),
      task({ urgencyKey: 'urgent', due: 20 }),
      task({ statusKey: 'quality_check', due: 20, assignee: PEOPLE[0] }),
      task({ due: 3, assignee: PEOPLE[0] }),
      task({ due: 30, assignee: PEOPLE[0] }),
      task({ due: null, assignee: PEOPLE[0] }),
    ]
    const groups = groupTasks(tasks, 'smart', context())
    expect(total(groups)).toBe(tasks.length)
    const seen = groups.flatMap((group) => group.tasks.map((row) => String(row.id)))
    expect(new Set(seen).size).toBe(tasks.length)
  })

  it('sorts undated work into Unscheduled rather than dropping it', () => {
    const groups = groupTasks([task({ due: null, assignee: PEOPLE[0] })], 'smart', context())
    expect(groups.find((group) => group.tasks.length)?.label).toBe('Unscheduled')
  })
})

describe('groupTasks by field', () => {
  it('groups by status and carries the status colour', () => {
    const groups = groupTasks([task({ statusKey: 'blocked' })], 'status', context())
    const blocked = groups.find((group) => group.label === 'Blocked')
    expect(blocked?.tasks).toHaveLength(1)
    expect(blocked?.color).toBe('var(--danger)')
  })

  it('groups by urgency', () => {
    const groups = groupTasks([task({ urgencyKey: 'high' })], 'urgency', context())
    expect(groups.find((group) => group.label === 'High')?.tasks).toHaveLength(1)
  })

  it('groups by project and hints the client', () => {
    const rows = [task({ project: { id: 7, name: 'Launch', client: { id: 3, name: 'Acme' } } } as Partial<Task>)]
    const groups = groupTasks(rows, 'project', context())
    expect(groups[0]).toMatchObject({ label: 'Launch', hint: 'Acme' })
  })

  it('groups by assignee and keeps an Unassigned group at the end', () => {
    const rows = [task({ assignee: PEOPLE[0] }), task()]
    const groups = groupTasks(rows, 'assignee', context())
    expect(groups.at(-1)).toMatchObject({ label: 'Unassigned' })
    expect(groups.at(-1)?.tasks).toHaveLength(1)
    expect(groups.find((group) => group.label === 'Sam Kaur')?.tasks).toHaveLength(1)
  })

  it('returns one group when grouping is off', () => {
    const rows = [task(), task()]
    expect(groupTasks(rows, 'none', context())).toEqual([{ key: 'all', label: 'All', tasks: rows }])
  })
})

describe('sortTasks', () => {
  it('puts the latest work first and breaks ties on urgency', () => {
    const late = task({ due: -3, title: 'late' })
    const soonUrgent = task({ due: 1, urgencyKey: 'urgent', title: 'soon urgent' })
    const soonCalm = task({ due: 1, urgencyKey: 'low', title: 'soon calm' })
    const order = sortTasks([soonCalm, soonUrgent, late], 'smart').map((row) => row.title)
    expect(order).toEqual(['late', 'soon urgent', 'soon calm'])
  })

  it('sorts undated work last under both date orderings', () => {
    const dated = task({ due: 20, title: 'dated' })
    const undated = task({ due: null, title: 'undated' })
    expect(sortTasks([undated, dated], 'smart').map((row) => row.title)).toEqual(['dated', 'undated'])
    expect(sortTasks([undated, dated], 'due').map((row) => row.title)).toEqual(['dated', 'undated'])
  })

  it('sorts by urgency, then by date', () => {
    const urgentLater = task({ urgencyKey: 'urgent', due: 10, title: 'urgent later' })
    const normalNow = task({ urgencyKey: 'normal', due: 0, title: 'normal now' })
    expect(sortTasks([normalNow, urgentLater], 'urgency').map((row) => row.title)).toEqual(['urgent later', 'normal now'])
  })

  it('sorts most recently updated first', () => {
    const old = task({ title: 'old', updated_at: '2026-08-01T10:00:00Z' } as Partial<Task>)
    const fresh = task({ title: 'fresh', updated_at: '2026-08-05T10:00:00Z' } as Partial<Task>)
    expect(sortTasks([old, fresh], 'updated').map((row) => row.title)).toEqual(['fresh', 'old'])
  })

  it('sorts by title', () => {
    const order = sortTasks([task({ title: 'Beta' }), task({ title: 'Alpha' })], 'title').map((row) => row.title)
    expect(order).toEqual(['Alpha', 'Beta'])
  })

  it('leaves the array it was given untouched', () => {
    const rows = [task({ due: 5, title: 'b' }), task({ due: -5, title: 'a' })]
    sortTasks(rows, 'due')
    expect(rows.map((row) => row.title)).toEqual(['b', 'a'])
  })
})

describe('flatTaskIds', () => {
  it('walks the groups in order and skips the collapsed ones', () => {
    const groups: TaskGroup[] = [
      { key: 'blocked', label: 'Blocked', tasks: [task({ id: 1 }), task({ id: 2 })] },
      { key: 'overdue', label: 'Overdue', tasks: [task({ id: 3 })] },
    ]
    expect(flatTaskIds(groups, {})).toEqual(['1', '2', '3'])
    expect(flatTaskIds(groups, { blocked: true })).toEqual(['3'])
  })
})
