import { fieldLabel } from './api'
import type { FieldValue, Task } from '../types/api'

/**
 * What a task's status and urgency *mean*, independent of what this workspace
 * calls them.
 *
 * A workspace configures its own status vocabulary, so nothing here may key on
 * a label, and grouping may not key on a slug either. The server resolves each
 * status value to one of five roles and each urgency value to a rank, and sends
 * them on the value itself (`App\Support\TaskSignals`). This module reads those,
 * and keeps a fallback map for the same canonical slugs so an older payload —
 * or a fixture — still lands in the right bucket instead of silently reading as
 * "open" and disappearing from Triage.
 */
export type StatusRole = 'open' | 'active' | 'review' | 'blocked' | 'done'

const STATUS_ROLE_FALLBACK: Record<string, StatusRole> = {
  planning: 'open',
  pending: 'open',
  in_progress: 'active',
  quality_check: 'review',
  blocked: 'blocked',
  needs_correction: 'blocked',
  complete: 'done',
}

const URGENCY_RANK_FALLBACK: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
}

/** Colour per role, so a status this build has never seen is still coloured. */
const ROLE_COLORS: Record<StatusRole, string> = {
  open: 'var(--t3)',
  active: 'var(--brand)',
  review: 'var(--warn)',
  blocked: 'var(--danger)',
  done: 'var(--good)',
}

const RANK_COLORS = ['var(--danger)', 'var(--warn)', 'var(--t3)', 'var(--t6)']

/** The unresolved default: a status nobody has mapped is treated as open work. */
export const DEFAULT_STATUS_ROLE: StatusRole = 'open'
/** Mid rank, so an unmapped urgency neither shouts nor hides. */
export const DEFAULT_URGENCY_RANK = 2

function asValue(value: unknown): FieldValue | null {
  return value && typeof value === 'object' ? (value as FieldValue) : null
}

function slugOf(value: unknown): string {
  const record = asValue(value)
  if (record) return String(record.key ?? record.key_name ?? '')
  return typeof value === 'string' ? value : ''
}

export function statusRole(value: unknown): StatusRole {
  const record = asValue(value)
  if (record?.role && record.role in ROLE_COLORS) return record.role as StatusRole
  return STATUS_ROLE_FALLBACK[slugOf(value)] ?? DEFAULT_STATUS_ROLE
}

export function urgencyRank(value: unknown): number {
  const record = asValue(value)
  if (typeof record?.rank === 'number') return record.rank
  return URGENCY_RANK_FALLBACK[slugOf(value)] ?? DEFAULT_URGENCY_RANK
}

/**
 * A status value's colour. The workspace's own colour wins when it has one —
 * it is configurable for a reason — and the role colour covers the rest.
 */
export function statusColor(value: unknown): string {
  return asValue(value)?.color || ROLE_COLORS[statusRole(value)]
}

export function urgencyColor(value: unknown): string {
  return asValue(value)?.color || RANK_COLORS[Math.min(urgencyRank(value), RANK_COLORS.length - 1)]
}

/**
 * The urgency rail carries only what is worth interrupting for. Normal and low
 * urgency get no colour, so a list of ordinary work reads as calm and the two
 * ranks that matter stand out.
 */
export function railColor(value: unknown, done = false): string | null {
  if (done) return null
  return urgencyRank(value) <= 1 ? urgencyColor(value) : null
}

// --- dates -----------------------------------------------------------------

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** Whole days from today to `iso`. Negative is in the past. */
export function dayDiff(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null
  const parsed = new Date(`${iso.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return null
  return Math.round((startOfDay(parsed) - startOfDay(now)) / 86_400_000)
}

export type DueTone = 'over' | 'today' | 'soon' | 'later' | 'none'

const DUE_TONE_COLORS: Record<DueTone, string> = {
  over: 'text-danger',
  today: 'text-warn',
  soon: 'text-t2',
  later: 'text-t3',
  none: 'text-t4',
}

export interface DueMeta {
  label: string
  tone: DueTone
  className: string
}

/**
 * How a due date reads in a row: relative while it still matters, absolute once
 * it is far enough out that the weekday stops being useful.
 */
export function dueMeta(iso: string | null | undefined, now = new Date()): DueMeta {
  const days = dayDiff(iso, now)
  const tone: DueTone = days === null
    ? 'none'
    : days < 0
      ? 'over'
      : days === 0
        ? 'today'
        : days < 7
          ? 'soon'
          : 'later'

  let label = '—'
  if (days !== null) {
    if (days < 0) label = `${Math.abs(days)}d late`
    else if (days === 0) label = 'Today'
    else if (days === 1) label = 'Tomorrow'
    else if (days < 7) label = new Date(`${iso!.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })
    else label = new Date(`${iso!.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  return { label, tone, className: DUE_TONE_COLORS[tone] }
}

/** `4h 20m`, `4h`, `20m`, or empty — never `0m`, which is noise in a row. */
/**
 * `01:12:04` — a running clock, which is read in hours and has to keep its
 * columns still while the seconds change.
 */
export function formatClock(seconds: number | null | undefined): string {
  const safe = Math.max(0, Math.floor(seconds ?? 0))
  const parts = [Math.floor(safe / 3600), Math.floor((safe % 3600) / 60), safe % 60]
  return parts.map((part) => String(part).padStart(2, '0')).join(':')
}

export function formatMinutes(minutes: number | null | undefined): string {
  const total = Math.max(0, Math.round(minutes ?? 0))
  if (!total) return ''
  const hours = Math.floor(total / 60)
  const rest = total % 60
  if (!hours) return `${rest}m`
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

// --- task readers ----------------------------------------------------------

/**
 * The API returns camel and snake spellings depending on the endpoint, and
 * status may arrive as a value object or a bare slug. These readers are the
 * only place that has to know.
 */
export function taskStatusValue(task: Task) {
  return task.statusValue ?? task.status_value ?? task.status
}

export function taskUrgencyValue(task: Task) {
  return task.urgencyValue ?? task.urgency_value ?? task.urgency
}

export function taskDueDate(task: Task): string | null {
  return task.dueDate ?? task.due_date ?? null
}

export function taskLoggedMinutes(task: Task): number {
  return task.actualMinutes ?? task.actual_minutes ?? 0
}

export function taskProjectId(task: Task) {
  return task.projectId ?? task.project_id ?? task.project?.id
}

export function taskRole(task: Task): StatusRole {
  return statusRole(taskStatusValue(task))
}

export function isTaskDone(task: Task): boolean {
  return taskRole(task) === 'done'
}

export function taskStatusLabel(task: Task): string {
  return fieldLabel(taskStatusValue(task))
}

export interface SubtaskProgress {
  total: number
  done: number
}

/**
 * Subtask progress. The list endpoint sends counts rather than the rows, so
 * both shapes have to be understood — and a detail payload that carries the
 * rows is the more trustworthy of the two.
 */
export function subtaskProgress(task: Task): SubtaskProgress {
  const rows = task.subtasks
  if (rows?.length) {
    return {
      total: rows.length,
      done: rows.filter((row) => Boolean(row.completedAt ?? row.completed_at) || statusRole(row.status ?? row.statusValue ?? row.status_value) === 'done').length,
    }
  }
  const counted = task as Task & {
    subtasksCount?: number
    subtasks_count?: number
    completedSubtasksCount?: number
    completed_subtasks_count?: number
  }
  return {
    total: counted.subtasksCount ?? counted.subtasks_count ?? 0,
    done: counted.completedSubtasksCount ?? counted.completed_subtasks_count ?? 0,
  }
}

/**
 * The meta line under a row title: project, checklist progress, logged time,
 * and whether it is blocked. Only the parts that exist appear, so a bare task
 * shows its project and nothing else.
 */
export function taskMetaParts(task: Task): string[] {
  const parts: string[] = []
  if (task.project?.name) parts.push(task.project.name)
  const progress = subtaskProgress(task)
  if (progress.total) parts.push(`${progress.done}/${progress.total}`)
  const logged = formatMinutes(taskLoggedMinutes(task))
  if (logged) parts.push(logged)
  if (taskRole(task) === 'blocked') parts.push('blocked')
  return parts
}
