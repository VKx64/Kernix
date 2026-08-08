import { useCallback, useEffect, useState } from 'react'
import { api, unwrap } from './api'
import type { ApiEnvelope, Dashboard, DashboardRange } from '../types/api'

/**
 * The dashboard, refetched when the range toggle moves.
 *
 * Everything on the screen comes from this one request. Splitting it per panel
 * would let the metric row disagree with the list beneath it — the counts and
 * the tasks they count have to be one snapshot.
 */
export function useDashboard(range: DashboardRange) {
  const [data, setData] = useState<Dashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    try {
      setData(unwrap(await api.get<ApiEnvelope<Dashboard>>('/api/dashboard', { range }, signal)))
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      setError(reason instanceof Error ? reason.message : 'Unable to load your dashboard.')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [range])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  return { data, loading, error, reload: () => load() }
}
