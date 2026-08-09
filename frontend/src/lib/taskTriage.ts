import { displayName, fieldLabel } from './api'
import {
  dayDiff,
  statusColor,
  taskDueDate,
  taskProjectId,
  taskRole,
  taskStatusValue,
  taskUrgencyValue,
  urgencyColor,
  urgencyRank,
} from './taskSignals'
import type { FieldValue, Task, UserSummary } from '../types/api'

/**
 * How the task list is cut up and ordered.
 *
 * The screen opens on a judgement, not an inventory: the default grouping is by
 * what makes a task need attention — blocked, then late, then due today, then
 * unowned — and each task lands in the *first* bucket that claims it, so a task
 * that is both blocked and overdue is reported once, under the reason you would
 * act on. Everything calmer falls through to the date buckets.
 */
export type TaskView = 'triage' | 'mine' | 'all' | 'unassigned' | 'done'

export const TASK_VIEWS: ReadonlyArray<{ value: TaskView; label: string }> = [
  { value: 'triage', label: 'Triage' },
  { value: 'mine', label: 'My work' },
  { value: 'all', label: 'All' },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'done', label: 'Done' },
]

export type TaskGroupBy = 'smart' | 'status' | 'urgency' | 'project' | 'assignee' | 'none'

export const TASK_GROUP_OPTIONS: ReadonlyArray<{ value: TaskGroupBy; label: string }> = [
  { value: 'smart', label: 'Attention' },
  { value: 'status', label: 'Status' },
  { value: 'urgency', label: 'Urgency' },
  { value: 'project', label: 'Project' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'none', label: 'Nothing' },
]

export type TaskSort = 'smart' | 'due' | 'urgency' | 'updated' | 'title'

export const TASK_SORT_OPTIONS: ReadonlyArray<{ value: TaskSort; label: string }> = [
  { value: 'smart', label: 'Lateness' },
  { value: 'due', label: 'Due date' },
  { value: 'urgency', label: 'Urgency' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'title', label: 'Title' },
]

/**
 * How the same view is laid out. All three share the view, filters, grouping
 * and ordering — only the shape on screen changes, so switching is never a
 * change of what you are looking at.
 */
export type TaskLayout = 'grouped' | 'list' | 'board'

export const TASK_LAYOUT_OPTIONS: ReadonlyArray<{ value: TaskLayout; label: string }> = [
  { value: 'grouped', label: 'Groups' },
  { value: 'list', label: 'List' },
  { value: 'board', label: 'Board' },
]

export function asTaskLayout(value: string | null | undefined): TaskLayout {
  return TASK_LAYOUT_OPTIONS.some((option) => option.value === value) ? (value as TaskLayout) : 'grouped'
}

export interface TaskGroup {
  key: string
  label: string
  /** Tints the group heading. Absent for a neutral grouping like project. */
  color?: string
  /** Sits beside the heading — a project's client, for instance. */
  hint?: string
  tasks: Task[]
}

const FAR_FUTURE = 9e15

function dueSortKey(task: Task): number {
  const iso = taskDueDate(task)
  return iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).getTime() : FAR_FUTURE
}

function updatedAt(task: Task): number {
  const record = task as Task & { updatedAt?: string; updated_at?: string }
  const value = record.updatedAt ?? record.updated_at
  return value ? new Date(value).getTime() : 0
}

const COMPARATORS: Record<TaskSort, (a: Task, b: Task) => number> = {
  // Lateness first, then urgency: the design's default, and the only ordering
  // that answers "what do I touch next" without reading the rows.
  smart: (a, b) => dueSortKey(a) - dueSortKey(b) || urgencyRank(taskUrgencyValue(a)) - urgencyRank(taskUrgencyValue(b)),
  due: (a, b) => dueSortKey(a) - dueSortKey(b),
  urgency: (a, b) => urgencyRank(taskUrgencyValue(a)) - urgencyRank(taskUrgencyValue(b)) || dueSortKey(a) - dueSortKey(b),
  updated: (a, b) => updatedAt(b) - updatedAt(a),
  title: (a, b) => a.title.localeCompare(b.title),
}

export function sortTasks(tasks: Task[], sort: TaskSort): Task[] {
  return tasks.slice().sort(COMPARATORS[sort])
}

/** True when a task is one of the things Triage exists to surface. */
export function needsTriage(task: Task, now = new Date()): boolean {
  if (taskRole(task) === 'done') return false
  const role = taskRole(task)
  if (role === 'blocked' || role === 'review') return true
  const days = dayDiff(taskDueDate(task), now)
  if (days !== null && days <= 0) return true
  return !task.assignee && urgencyRank(taskUrgencyValue(task)) <= 1
}

interface SmartBucket {
  key: string
  label: string
  color?: string
  claims: (task: Task, now: Date) => boolean
}

const SMART_BUCKETS: SmartBucket[] = [
  { key: 'blocked', label: 'Blocked', color: 'var(--danger)', claims: (task) => taskRole(task) === 'blocked' },
  {
    key: 'overdue',
    label: 'Overdue',
    color: 'var(--danger)',
    claims: (task, now) => {
      const days = dayDiff(taskDueDate(task), now)
      return days !== null && days < 0
    },
  },
  {
    key: 'today',
    label: 'Due today',
    color: 'var(--warn)',
    claims: (task, now) => dayDiff(taskDueDate(task), now) === 0,
  },
  {
    key: 'unowned',
    label: 'No owner',
    color: 'var(--brand)',
    claims: (task) => !task.assignee && urgencyRank(taskUrgencyValue(task)) <= 1,
  },
  { key: 'review', label: 'In review', color: 'var(--warn)', claims: (task) => taskRole(task) === 'review' },
  {
    key: 'week',
    label: 'This week',
    claims: (task, now) => {
      const days = dayDiff(taskDueDate(task), now)
      return days !== null && days > 0 && days < 7
    },
  },
  {
    key: 'later',
    label: 'Later',
    claims: (task, now) => {
      const days = dayDiff(taskDueDate(task), now)
      return days !== null && days >= 7
    },
  },
  { key: 'unscheduled', label: 'Unscheduled', claims: () => true },
]

export interface GroupTasksContext {
  statusOptions: FieldValue[]
  urgencyOptions: FieldValue[]
  people: UserSummary[]
  now?: Date
}

/**
 * Cuts a sorted list into groups. Empty groups are dropped by the caller, not
 * here, so a caller that wants to show an empty column — the board does — can.
 */
export function groupTasks(tasks: Task[], groupBy: TaskGroupBy, context: GroupTasksContext): TaskGroup[] {
  const now = context.now ?? new Date()

  if (groupBy === 'none') return [{ key: 'all', label: 'All', tasks }]

  if (groupBy === 'status') {
    return context.statusOptions.map((option) => ({
      key: `status-${option.id}`,
      label: fieldLabel(option),
      color: statusColor(option),
      tasks: tasks.filter((task) => sameValue(taskStatusValue(task), option)),
    }))
  }

  if (groupBy === 'urgency') {
    return context.urgencyOptions.map((option) => ({
      key: `urgency-${option.id}`,
      label: fieldLabel(option),
      color: urgencyColor(option),
      tasks: tasks.filter((task) => sameValue(taskUrgencyValue(task), option)),
    }))
  }

  if (groupBy === 'project') {
    const seen = new Map<string, TaskGroup>()
    for (const task of tasks) {
      const id = String(taskProjectId(task) ?? 'none')
      if (!seen.has(id)) {
        seen.set(id, {
          key: `project-${id}`,
          label: task.project?.name ?? 'No project',
          hint: task.project?.client?.name,
          tasks: [],
        })
      }
      seen.get(id)!.tasks.push(task)
    }
    return [...seen.values()]
  }

  if (groupBy === 'assignee') {
    const groups = context.people.map((person) => ({
      key: `assignee-${person.id}`,
      label: displayName(person),
      tasks: tasks.filter((task) => String(task.assignee?.id ?? '') === String(person.id)),
    }))
    return groups.concat([{ key: 'assignee-none', label: 'Unassigned', tasks: tasks.filter((task) => !task.assignee) }])
  }

  // Smart: first bucket to claim a task keeps it.
  const claimed = new Set<string>()
  return SMART_BUCKETS.map((bucket) => {
    const owned = tasks.filter((task) => {
      const id = String(task.id)
      if (claimed.has(id)) return false
      if (!bucket.claims(task, now)) return false
      claimed.add(id)
      return true
    })
    return { key: bucket.key, label: bucket.label, color: bucket.color, tasks: owned }
  })
}

function sameValue(value: unknown, option: FieldValue): boolean {
  if (!value) return false
  if (typeof value === 'object') {
    const record = value as FieldValue
    if (record.id !== undefined) return String(record.id) === String(option.id)
    return String(record.key ?? '') === String(option.key ?? '')
  }
  return String(value) === String(option.key ?? option.id)
}

// --- saved views -----------------------------------------------------------

/**
 * A saved view is the whole question — which view, filtered how, grouped and
 * ordered how, laid out how — under a name. The design tried these as places in
 * the sidebar and rejected it: they are not places, so they live in a menu on
 * the screen they belong to.
 *
 * There is no server for them. They are one person's shortcuts on one machine,
 * and nothing else in the product reads them.
 */
export interface SavedTaskView {
  id: string
  name: string
  view: TaskView
  group: TaskGroupBy
  sort: TaskSort
  layout: TaskLayout
  /** Filter params exactly as the URL carries them, `archived` included. */
  filters: Record<string, string>
}

/** The filter params a saved view captures, and the ones applying one clears. */
export const TASK_FILTER_PARAMS = ['project_id', 'assignee_user_id', 'status_value_id', 'urgency_value_id', 'archived'] as const

const SAVED_VIEWS_STORAGE_KEY = 'kernix.tasks.saved-views'

function isSavedView(value: unknown): value is SavedTaskView {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<SavedTaskView>
  return typeof record.id === 'string' && typeof record.name === 'string' && typeof record.filters === 'object'
}

export function readSavedViews(): SavedTaskView[] {
  try {
    const raw = window.localStorage?.getItem(SAVED_VIEWS_STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(isSavedView) : []
  } catch {
    // Unreadable or unavailable storage means no saved views, never a crash.
    return []
  }
}

export function writeSavedViews(views: SavedTaskView[]): void {
  try {
    window.localStorage?.setItem(SAVED_VIEWS_STORAGE_KEY, JSON.stringify(views))
  } catch {
    // Private browsing and full quotas both land here; the views stay for this session only.
  }
}

/** True when the screen is currently showing exactly what this view saved. */
export function savedViewMatches(saved: SavedTaskView, current: Omit<SavedTaskView, 'id' | 'name'>): boolean {
  if (saved.view !== current.view || saved.group !== current.group) return false
  if (saved.sort !== current.sort || saved.layout !== current.layout) return false
  const keys = new Set([...Object.keys(saved.filters), ...Object.keys(current.filters)])
  for (const key of keys) {
    if (saved.filters[key] !== current.filters[key]) return false
  }
  return true
}

/** Flat id order across open groups — what `j`/`k` walk. */
export function flatTaskIds(groups: TaskGroup[], collapsed: Record<string, boolean>): string[] {
  const ids: string[] = []
  for (const group of groups) {
    if (collapsed[group.key]) continue
    for (const task of group.tasks) ids.push(String(task.id))
  }
  return ids
}
