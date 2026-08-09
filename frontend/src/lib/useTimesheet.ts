import { useCallback, useEffect, useState } from 'react'
import { api, unwrap } from './api'
import type { ApiEnvelope, EntityId, Timesheet, TimesheetCutoff, TimesheetRow } from '../types/api'

/**
 * One pay period's worth of tracked time.
 *
 * Editing a description patches the row in place rather than refetching: the
 * server returns the updated row, and re-pulling the whole period would scroll
 * a long timesheet back to the top for a one-word change.
 */
export function useTimesheet(cutoff: TimesheetCutoff, offset: number) {
  const [data, setData] = useState<Timesheet | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    try {
      setData(unwrap(await api.get<ApiEnvelope<Timesheet>>('/api/timesheet', { cutoff, offset }, signal)))
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      setError(reason instanceof Error ? reason.message : 'Unable to load your timesheet.')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [cutoff, offset])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const describe = useCallback(async (taskId: EntityId, date: string, body: string) => {
    const updated = unwrap(
      await api.put<ApiEnvelope<TimesheetRow>>('/api/timesheet/description', { task_id: taskId, date, body }),
    )
    setData((current) => current && {
      ...current,
      lanes: current.lanes.map((lane) => ({
        ...lane,
        rows: lane.rows.map((row) =>
          String(row.task_id) === String(taskId) && row.date === date ? updated : row,
        ),
      })),
    })
  }, [])

  return { data, loading, error, reload: () => load(), describe }
}
