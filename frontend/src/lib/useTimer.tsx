import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useWorkspace } from '../auth/WorkspaceProvider'
import { api, unwrap } from './api'
import { useCan } from './permissions'
import type { ApiEnvelope, BreakKind, TimerStatus, TimerStopStatus, TimerTaskRef } from '../types/api'

export type TimerState = 'idle' | 'working' | 'break'

/** The ten columns of the day chart: 9am through 6pm. */
export const FIRST_HOUR = 9
export const LAST_HOUR = 18

const EMPTY: TimerStatus = {
  entry: null,
  paused_task: null,
  paused_seconds: 0,
  clocked_in: false,
  today: { work_minutes: 0, break_minutes: 0, hours: [] },
  week: [],
}

export interface TimerHourColumn {
  hour: number
  workMinutes: number
  breakMinutes: number
  /** The hour the clock is in right now, which is the one that animates. */
  live: boolean
}

export interface Timer {
  state: TimerState
  /** Attendance, which outlives the timer: the day stays open after a stop. */
  clockedIn: boolean
  busy: boolean
  loading: boolean
  /** The task being tracked, or the one a break will resume onto. */
  task: TimerTaskRef | null
  breakKind: BreakKind | null
  /** Seconds on the current run — work seconds when working, break seconds on a break. */
  seconds: number
  /** Work banked on `task` this sitting, shown while a break runs. */
  pausedSeconds: number
  /** Minutes tracked today, including the run in progress. */
  todayMinutes: number
  /** Null on an open-ended break; otherwise when the break is due to end. */
  breakDueAt: Date | null
  /** Minutes past a break's expected end, 0 when not over. */
  overBy: number
  hours: TimerHourColumn[]
  /** The sidebar break menu, controlled so `B` can open it from anywhere. */
  breakMenuOpen: boolean
  setBreakMenuOpen: (open: boolean) => void
  start: (taskId?: number | string | null) => Promise<void>
  takeBreak: (kind: BreakKind, minutes: number) => Promise<void>
  resume: () => Promise<void>
  stop: () => Promise<{ minutes: number; task: TimerTaskRef | null } | null>
  refresh: () => Promise<void>
}

/**
 * The sidebar timer, and the single source of what is being tracked.
 *
 * Elapsed time is derived from the server's `started_at` on every tick rather
 * than counted up in state, so a reload — or a laptop that slept through
 * lunch — resumes on the true elapsed time instead of resetting to zero. The
 * one-second interval exists only to re-render; it never accumulates.
 *
 * Break and resume change whether the workspace considers the user able to
 * mutate tasks, so both refresh the workspace after they land.
 *
 * Call this once, in the shell, and read it through `useTimerContext`
 * everywhere else: two instances would poll twice and could disagree about
 * what is running.
 */
function useTimerState(): Timer {
  const can = useCan()
  const canTrack = can('time.track')
  const { refresh: refreshWorkspace } = useWorkspace()
  const [status, setStatus] = useState<TimerStatus>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [breakMenuOpen, setBreakMenuOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const entry = status.entry
  const state: TimerState = !entry ? 'idle' : entry.kind === 'break' ? 'break' : 'working'
  const running = state !== 'idle'

  const refresh = useCallback(async () => {
    if (!canTrack) {
      setStatus(EMPTY)
      setLoading(false)
      return
    }
    try {
      setStatus(unwrap(await api.get<ApiEnvelope<TimerStatus>>('/api/time/timer')))
    } catch {
      // The timer is ambient chrome; a failed poll should not raise an error
      // over whatever the user is actually doing. The next tick tries again.
    } finally {
      setLoading(false)
    }
  }, [canTrack])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    if (!running) return
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(tick)
  }, [running])

  // A tab left open all day would otherwise drift out of step with time logged
  // from another device, and would never notice the day rolling over.
  useEffect(() => {
    if (!canTrack) return
    const poll = window.setInterval(() => void refresh(), 60_000)
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => { window.clearInterval(poll); window.removeEventListener('focus', onFocus) }
  }, [canTrack, refresh])

  const act = useCallback(async <T extends TimerStatus>(path: string, body?: Record<string, unknown>) => {
    setBusy(true)
    try {
      const next = unwrap(await api.post<ApiEnvelope<T>>(`/api/time/timer/${path}`, body))
      setStatus(next)
      await refreshWorkspace()
      return next
    } finally {
      setBusy(false)
    }
  }, [refreshWorkspace])

  const seconds = entry
    ? Math.max(0, Math.floor((now - new Date(entry.started_at).getTime()) / 1000))
    : 0

  const breakDueAt = entry?.kind === 'break' && entry.break_due_minutes
    ? new Date(new Date(entry.started_at).getTime() + entry.break_due_minutes * 60_000)
    : null
  const overBy = breakDueAt && now > breakDueAt.getTime()
    ? Math.max(1, Math.round((now - breakDueAt.getTime()) / 60_000))
    : 0

  const hours = useMemo(() => {
    const byHour = new Map(status.today.hours.map((bucket) => [bucket.hour, bucket]))
    const liveHour = new Date(now).getHours()
    return Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, index) => {
      const hour = FIRST_HOUR + index
      const bucket = byHour.get(hour)
      // The hour before 9am and after 6pm still has to land somewhere, matching
      // how the server clamps its own buckets.
      const live = running && Math.min(LAST_HOUR, Math.max(FIRST_HOUR, liveHour)) === hour
      const elapsedMinutes = live ? seconds / 60 : 0
      return {
        hour,
        workMinutes: (bucket?.work_minutes ?? 0) + (state === 'working' ? elapsedMinutes : 0),
        breakMinutes: (bucket?.break_minutes ?? 0) + (state === 'break' ? elapsedMinutes : 0),
        live,
      }
    })
  }, [status.today.hours, now, running, seconds, state])

  return {
    state,
    clockedIn: status.clocked_in,
    busy,
    loading,
    task: entry?.task ?? status.paused_task,
    breakKind: entry?.break_kind ?? null,
    seconds,
    pausedSeconds: status.paused_seconds,
    todayMinutes: status.today.work_minutes + (state === 'working' ? seconds / 60 : 0),
    breakDueAt,
    overBy,
    hours,
    breakMenuOpen,
    setBreakMenuOpen,
    start: async (taskId) => { await act('start', { task_id: taskId ?? null }) },
    takeBreak: async (kind, minutes) => {
      setBreakMenuOpen(false)
      await act('break', { kind, due_minutes: minutes })
    },
    resume: async () => { await act('resume') },
    stop: async () => {
      const next = await act<TimerStopStatus>('stop')
      return next.logged ?? null
    },
    refresh,
  }
}

const TimerContext = createContext<Timer | null>(null)

export function TimerProvider({ children }: { children: ReactNode }) {
  return <TimerContext.Provider value={useTimerState()}>{children}</TimerContext.Provider>
}

export function useTimerContext(): Timer {
  const value = useContext(TimerContext)
  if (!value) throw new Error('useTimerContext must be used inside TimerProvider')
  return value
}
