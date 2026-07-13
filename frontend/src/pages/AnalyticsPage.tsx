import { useCallback, useEffect, useMemo, useState } from 'react'
import { ErrorBanner, Minutes, PageHeader, Panel } from '../components/ui'
import { api, ApiError, displayName, unwrap } from '../lib/api'
import type { AnalyticsData, ApiEnvelope, EntityId, UserSummary } from '../types/api'

interface AnalyticsRow {
  id?: EntityId
  name?: string
  task_title?: string
  project_name?: string
  client_name?: string
  user?: UserSummary
  minutes?: number
  time_minutes?: number
  worked_minutes?: number
  created_at?: string
  clock_in_at?: string
}

interface AnalyticsResponse extends AnalyticsData {
  entries?: AnalyticsRow[]
  sessions?: AnalyticsRow[]
  total_minutes?: number
  range_minutes?: number
  today_minutes?: number
}

function dateInput(date: Date) {
  return new Intl.DateTimeFormat('en-CA').format(date)
}

function BarList({ rows }: { rows: Array<{ name: string; minutes: number; count?: number }> }) {
  const max = Math.max(1, ...rows.map((row) => Number(row.minutes || 0)))
  if (!rows.length) return <div className="chart-empty">No time has been logged in this range.</div>
  return <div className="bar-list">{rows.slice(0, 10).map((row) => <div key={row.name}><div className="bar-label"><strong>{row.name}</strong><Minutes value={row.minutes} /></div><div className="bar-track"><span style={{ width: `${Math.max(2, Number(row.minutes || 0) / max * 100)}%` }} /></div></div>)}</div>
}

export function AnalyticsPage() {
  const initialFrom = useMemo(() => { const value = new Date(); value.setDate(1); return dateInput(value) }, [])
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(() => dateInput(new Date()))
  const [data, setData] = useState<AnalyticsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError('')
    try {
      try {
        const response = await api.get<ApiEnvelope<AnalyticsResponse> | AnalyticsResponse>('/api/analytics', { from, to }, signal)
        setData(unwrap(response))
      } catch (reason) {
        if (!(reason instanceof ApiError) || reason.status !== 404) throw reason
        const response = await api.get<ApiEnvelope<AnalyticsResponse> | AnalyticsResponse>('/api/time/summary', { from, to }, signal)
        setData(unwrap(response))
      }
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      setError(reason instanceof Error ? reason.message : 'Unable to load analytics.')
    } finally { if (!signal?.aborted) setLoading(false) }
  }, [from, to])

  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort() }, [load])

  const entries = data?.entries ?? data?.sessions ?? []
  const timelineRows: AnalyticsRow[] = (data?.timeline ?? []).map((row) => ({ name: `${row.count ?? 0} logged ${row.count === 1 ? 'entry' : 'entries'}`, minutes: row.minutes, created_at: row.date }))
  const records = entries.length ? entries : timelineRows
  const total = data?.totals?.minutes ?? data?.totals?.total_minutes ?? data?.total_minutes ?? data?.range_minutes ?? records.reduce((sum, row) => sum + Number(row.minutes ?? row.time_minutes ?? row.worked_minutes ?? 0), 0)
  const entryCount = data?.totals?.entries ?? entries.length
  const byProject = data?.byProject ?? data?.by_project ?? []
  const byUser = data?.byUser ?? data?.by_user ?? []
  const average = entryCount ? Math.round(total / entryCount) : 0

  return (
    <div>
      <PageHeader eyebrow="Reporting" title="Analytics" description="Understand where work time is going without counting task totals twice." actions={<div className="date-range"><label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><span>→</span><label>To<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label></div>} />
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      <div className="analytics-summary">
        <Panel><span className="eyebrow">Total logged</span><strong>{loading ? '—' : <Minutes value={total} />}</strong><p>One sum of time-entry or session records.</p></Panel>
        <Panel><span className="eyebrow">Entries</span><strong>{loading ? '—' : entryCount}</strong><p>Records inside the selected range.</p></Panel>
        <Panel><span className="eyebrow">Average entry</span><strong>{loading ? '—' : <Minutes value={average} />}</strong><p>Average duration per record.</p></Panel>
      </div>
      <div className="chart-grid">
        <Panel title="Time by project"><BarList rows={byProject} /></Panel>
        <Panel title="Time by person"><BarList rows={byUser} /></Panel>
      </div>
      <Panel title="Time records">
        {loading ? <div className="panel-loading"><span className="spinner" /> Loading report…</div> : records.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Work</th><th>Person</th><th>Date</th><th className="numeric-cell">Time</th></tr></thead><tbody>{records.map((row, index) => <tr key={String(row.id ?? index)}><td><div className="primary-cell"><strong>{row.task_title ?? row.name ?? 'Work session'}</strong><span>{[row.project_name, row.client_name].filter(Boolean).join(' · ') || 'General time'}</span></div></td><td>{row.user ? displayName(row.user) : 'All visible users'}</td><td>{row.created_at ?? row.clock_in_at ? new Date((row.created_at ?? row.clock_in_at)!).toLocaleDateString() : '—'}</td><td className="numeric-cell"><Minutes value={row.minutes ?? row.time_minutes ?? row.worked_minutes} /></td></tr>)}</tbody></table></div> : <div className="empty-inline">No records were returned for this date range.</div>}
      </Panel>
    </div>
  )
}
