import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, unwrap } from '../lib/api'
import { useAuth } from './AuthProvider'
import { hasPermission } from '../lib/permissions'
import type { ApiEnvelope, AppSettings, TimeStatus } from '../types/api'

type TimeAction = 'clock-in' | 'clock-out' | 'break-start' | 'break-end'

interface WorkspaceContextValue {
  settings: AppSettings
  time: TimeStatus | null
  loading: boolean
  timeBusy: boolean
  singleClientMode: boolean
  canAdminOverride: boolean
  canMutateTasks: boolean
  isOnBreak: boolean
  /** Per-workspace feature switches. A missing key defaults to true — see lib/features.ts. */
  features: Record<string, boolean>

  /** One workspace-wide switch instead of a checkbox on every task form. */
  adminOverride: boolean
  setAdminOverride: (next: boolean) => void
  refresh: () => Promise<void>
  timeAction: (action: TimeAction) => Promise<void>
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

const OVERRIDE_STORAGE_KEY = 'kernix.admin-override'

function storedOverride(): boolean {
  try {
    return window.sessionStorage.getItem(OVERRIDE_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const canTrackTime = hasPermission(user, 'time.track')
  const [settings, setSettings] = useState<AppSettings>({})
  const [time, setTime] = useState<TimeStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [timeBusy, setTimeBusy] = useState(false)
  const [overrideRequested, setOverrideRequested] = useState(storedOverride)

  const refresh = useCallback(async () => {
    const [settingsResult, timeResult] = await Promise.allSettled([
      api.get<ApiEnvelope<AppSettings> | AppSettings>('/api/settings/context'),
      canTrackTime ? api.get<ApiEnvelope<TimeStatus> | TimeStatus>('/api/time') : Promise.resolve(null),
    ])
    if (settingsResult.status === 'fulfilled') setSettings(unwrap(settingsResult.value))
    if (timeResult.status === 'fulfilled') setTime(timeResult.value ? unwrap(timeResult.value) : null)
    setLoading(false)
  }, [canTrackTime])

  useEffect(() => { void refresh() }, [refresh])

  const timeAction = useCallback(async (action: TimeAction) => {
    if (!canTrackTime) throw new Error('Your role cannot track time.')
    setTimeBusy(true)
    try {
      await api.post(`/api/time/${action}`)
      await refresh()
    } finally {
      setTimeBusy(false)
    }
  }, [canTrackTime, refresh])

  const singleClientMode = Boolean(settings.singleClientMode ?? settings.single_client_mode)
  const features = useMemo(() => settings.features ?? {}, [settings.features])
  const isOnBreak = Boolean(
    time?.onBreak
    ?? time?.on_break
    ?? time?.isOnBreak
    ?? time?.is_on_break
    ?? time?.currentBreak
    ?? time?.current_break
    ?? (time?.state ?? time?.status) === 'break',
  )
  const canAdminOverride = !isOnBreak && Boolean(time?.canAdminOverride ?? time?.can_admin_override ?? settings.canAdminOverride ?? settings.can_admin_override)
  const explicitCanMutate = time?.canMutateTasks ?? time?.can_mutate_tasks
  const clockedIn = Boolean(
    time?.clockedIn
    ?? time?.clocked_in
    ?? time?.isClockedIn
    ?? time?.is_clocked_in
    ?? time?.session
    ?? ['working', 'clocked_in'].includes(time?.state ?? time?.status ?? 'clocked_out'),
  )
  const requiresClock = Boolean(settings.taskMutationsRequireClockIn ?? settings.task_mutations_require_clock_in ?? true)
  const canMutateTasks = !isOnBreak && (explicitCanMutate ?? (!requiresClock || clockedIn))
  // Losing the privilege (a break, a role change) drops the switch on its own,
  // so no screen can keep sending an override the server would reject.
  const adminOverride = canAdminOverride && overrideRequested

  const setAdminOverride = useCallback((next: boolean) => {
    setOverrideRequested(next)
    try {
      if (next) window.sessionStorage.setItem(OVERRIDE_STORAGE_KEY, '1')
      else window.sessionStorage.removeItem(OVERRIDE_STORAGE_KEY)
    } catch {
      // Private-mode storage failures leave the switch in memory only.
    }
  }, [])

  const value = useMemo(() => ({
    settings,
    time,
    loading,
    timeBusy,
    singleClientMode,
    canAdminOverride,
    canMutateTasks,
    isOnBreak,
    features,
    adminOverride,
    setAdminOverride,
    refresh,
    timeAction,
  }), [settings, time, loading, timeBusy, singleClientMode, canAdminOverride, canMutateTasks, isOnBreak, features, adminOverride, setAdminOverride, refresh, timeAction])

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider')
  return value
}
