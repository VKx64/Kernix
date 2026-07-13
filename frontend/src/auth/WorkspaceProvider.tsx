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
  refresh: () => Promise<void>
  timeAction: (action: TimeAction) => Promise<void>
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const canTrackTime = hasPermission(user, 'time.track')
  const [settings, setSettings] = useState<AppSettings>({})
  const [time, setTime] = useState<TimeStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [timeBusy, setTimeBusy] = useState(false)

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
  const canAdminOverride = Boolean(time?.canAdminOverride ?? time?.can_admin_override ?? settings.canAdminOverride ?? settings.can_admin_override)
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
  const canMutateTasks = explicitCanMutate ?? (!requiresClock || clockedIn)

  const value = useMemo(() => ({
    settings,
    time,
    loading,
    timeBusy,
    singleClientMode,
    canAdminOverride,
    canMutateTasks,
    refresh,
    timeAction,
  }), [settings, time, loading, timeBusy, singleClientMode, canAdminOverride, canMutateTasks, refresh, timeAction])

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider')
  return value
}
