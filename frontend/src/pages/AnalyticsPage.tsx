import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { ErrorBanner, Minutes, PageHeader, Panel } from '@/components/shared'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, ApiError, displayName, unwrap } from '@/lib/api'
import type { AnalyticsData, ApiEnvelope, EntityId, UserSummary } from '@/types/api'

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

const chartConfig = { minutes: { label: 'Minutes', color: 'var(--chart-1)' } } satisfies ChartConfig

/** Horizontal bars, matching the timesheet-style breakdowns this page used before. */
function TimeBarChart({ rows, label }: { rows: Array<{ name: string; minutes: number; count?: number }>; label: string }) {
  if (!rows.length) return <p className="py-8 text-center text-sm text-muted-foreground">No time has been logged in this range.</p>
  const top = rows.slice(0, 10).map((row) => ({ name: row.name, minutes: Number(row.minutes || 0) }))
  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-[280px] w-full" aria-label={label}>
      <BarChart data={top} layout="vertical" margin={{ left: 8, right: 12 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis type="number" tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={140} tick={{ fontSize: 12 }} />
        <ChartTooltip content={<ChartTooltipContent hideLabel formatter={(value) => `${value} min`} />} />
        <Bar dataKey="minutes" fill="var(--color-minutes)" radius={4} />
      </BarChart>
    </ChartContainer>
  )
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
    <div className="space-y-6">
      <PageHeader
        eyebrow="Reporting"
        title="Analytics"
        description="Understand where work time is going without counting task totals twice."
        actions={(
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="analytics-from" className="text-xs text-muted-foreground">From</Label>
              <Input id="analytics-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-8" />
            </div>
            <span className="pb-2 text-muted-foreground">→</span>
            <div className="space-y-1">
              <Label htmlFor="analytics-to" className="text-xs text-muted-foreground">To</Label>
              <Input id="analytics-to" type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className="h-8" />
            </div>
          </div>
        )}
      />
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      <div className="grid gap-3 sm:grid-cols-3">
        <Panel>
          <span className="text-xs uppercase tracking-widest text-muted-foreground">Total logged</span>
          <strong className="block text-2xl">{loading ? '—' : <Minutes value={total} />}</strong>
          <p className="text-sm text-muted-foreground">One sum of time-entry or session records.</p>
        </Panel>
        <Panel>
          <span className="text-xs uppercase tracking-widest text-muted-foreground">Entries</span>
          <strong className="block text-2xl">{loading ? '—' : entryCount}</strong>
          <p className="text-sm text-muted-foreground">Records inside the selected range.</p>
        </Panel>
        <Panel>
          <span className="text-xs uppercase tracking-widest text-muted-foreground">Average entry</span>
          <strong className="block text-2xl">{loading ? '—' : <Minutes value={average} />}</strong>
          <p className="text-sm text-muted-foreground">Average duration per record.</p>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Time by project"><TimeBarChart rows={byProject} label="Time by project" /></Panel>
        <Panel title="Time by person"><TimeBarChart rows={byUser} label="Time by person" /></Panel>
      </div>

      <Panel title="Time records">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-10" />)}
          </div>
        ) : records.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Work</TableHead>
                <TableHead>Person</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((row, index) => (
                <TableRow key={String(row.id ?? index)}>
                  <TableCell>
                    <div className="max-w-64">
                      <strong className="block truncate">{row.task_title ?? row.name ?? 'Work session'}</strong>
                      <span className="block truncate text-xs text-muted-foreground">{[row.project_name, row.client_name].filter(Boolean).join(' · ') || 'General time'}</span>
                    </div>
                  </TableCell>
                  <TableCell>{row.user ? displayName(row.user) : 'All visible users'}</TableCell>
                  <TableCell>{row.created_at ?? row.clock_in_at ? new Date((row.created_at ?? row.clock_in_at)!).toLocaleDateString() : '—'}</TableCell>
                  <TableCell className="text-right"><Minutes value={row.minutes ?? row.time_minutes ?? row.worked_minutes} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : <p className="text-sm text-muted-foreground">No records were returned for this date range.</p>}
      </Panel>
    </div>
  )
}
