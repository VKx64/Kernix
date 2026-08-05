import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight, Briefcase, Building2, Clock, Inbox, SquareCheck } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { useAuth } from '@/auth/AuthProvider'
import { Avatar, ErrorBanner, Minutes, PageHeader, Panel } from '@/components/shared'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { api, ApiError, displayName, unwrap } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import type { AnalyticsData, ApiEnvelope, DashboardData, EntityId, TeamTimeSummary, UserSummary } from '@/types/api'

interface DashboardEntry {
  id: EntityId
  task_id?: EntityId
  taskId?: EntityId
  task_title?: string
  taskTitle?: string
  project_name?: string
  projectName?: string
  client_name?: string
  clientName?: string
  time_minutes?: number
  timeMinutes?: number
  created_at?: string
  createdAt?: string
}

interface DashboardResponse extends DashboardData {
  today_minutes?: number
  range_minutes?: number
  entries?: DashboardEntry[]
  project_chart?: Array<{ name: string; minutes: number; color?: string }>
  client_chart?: Array<{ name: string; minutes: number; color?: string }>
  range?: { from: string; to: string }
}

/** Reporting rows, only fetched for roles that hold analytics.view. */
interface AnalyticsRow {
  id?: EntityId
  task_id?: EntityId
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
}

const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']

const chartConfig = { minutes: { label: 'Minutes', color: 'var(--chart-1)' } } satisfies ChartConfig

function localDate(date: Date) {
  return new Intl.DateTimeFormat('en-CA').format(date)
}

/** Horizontal bars, matching the timesheet-style breakdowns reporting used before. */
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

function Donut({ rows, label }: { rows: Array<{ name: string; minutes: number; color?: string }>; label: string }) {
  const total = rows.reduce((sum, row) => sum + Number(row.minutes || 0), 0)
  if (!rows.length || total <= 0) return <p className="py-8 text-center text-sm text-muted-foreground">No logged time in this range.</p>
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative size-36 shrink-0" aria-label={label}>
        <svg viewBox="0 0 42 42" className="size-full -rotate-90">
          <circle cx="21" cy="21" r="15.9" fill="none" stroke="var(--muted)" strokeWidth="6" />
          {rows.map((row, index) => {
            const value = Number(row.minutes || 0) / total * 100
            const offset = rows.slice(0, index).reduce((sum, previous) => sum + Number(previous.minutes || 0) / total * 100, 0)
            return (
              <circle
                key={`${row.name}-${index}`}
                cx="21" cy="21" r="15.9" fill="none"
                stroke={row.color || CHART_COLORS[index % CHART_COLORS.length]}
                strokeDasharray={`${value} ${100 - value}`}
                strokeDashoffset={-offset}
                strokeWidth="6"
              />
            )
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <strong className="text-lg"><Minutes value={total} /></strong>
          <span className="text-xs text-muted-foreground">Total</span>
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        {rows.slice(0, 6).map((row, index) => (
          <div key={`${row.name}-${index}`} className="flex items-center gap-2 text-sm">
            <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: row.color || CHART_COLORS[index % CHART_COLORS.length] }} />
            <span className="min-w-0 flex-1 truncate">{row.name}</span>
            <Minutes value={row.minutes} />
          </div>
        ))}
      </div>
    </div>
  )
}

function TeamTimeWidget({ summary }: { summary?: TeamTimeSummary }) {
  const sessions = summary?.sessions ?? []
  const clockedIn = summary?.clockedInCount ?? summary?.clocked_in_count ?? sessions.length
  const working = summary?.workingCount ?? summary?.working_count ?? sessions.filter((session) => (session.state ?? session.status) !== 'break').length
  const breaks = summary?.onBreakCount ?? summary?.on_break_count ?? sessions.filter((session) => (session.state ?? session.status) === 'break').length
  return (
    <Panel title="Team time now">
      <div className="mb-4 grid grid-cols-3 gap-3 text-center">
        <div><strong className="block text-xl">{clockedIn}</strong><span className="text-xs text-muted-foreground">Clocked in</span></div>
        <div><strong className="block text-xl">{working}</strong><span className="text-xs text-muted-foreground">Working</span></div>
        <div><strong className="block text-xl">{breaks}</strong><span className="text-xs text-muted-foreground">On break</span></div>
      </div>
      {sessions.length ? (
        <div className="space-y-2">
          {sessions.map((session) => {
            const person = session.user ?? { id: session.userId ?? session.user_id ?? session.id ?? '', name: session.name }
            const state = session.state ?? session.status ?? (session.currentBreakStartedAt ?? session.current_break_started_at ? 'break' : 'working')
            const started = session.clockInAt ?? session.clock_in_at ?? session.startedAt ?? session.started_at
            return (
              <div key={String(session.id ?? person.id)} className="flex items-center gap-3">
                <Avatar user={person} className="size-8" />
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-sm">{displayName(person)}</strong>
                  <span className="text-xs text-muted-foreground">{started ? `Since ${new Date(started).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Active session'}</span>
                </div>
                <StatusPill state={state} />
              </div>
            )
          })}
        </div>
      ) : <p className="text-sm text-muted-foreground">No one is clocked in right now.</p>}
    </Panel>
  )
}

function StatusPill({ state }: { state: string }) {
  const onBreak = state === 'break'
  return (
    <Badge variant="outline" className={cn(onBreak ? 'border-warning text-warning' : 'border-success text-success')}>
      {onBreak ? 'On break' : 'Working'}
    </Badge>
  )
}

const CARD_ICON: Record<string, typeof SquareCheck> = {
  task: SquareCheck,
  inbox: Inbox,
  briefcase: Briefcase,
  building: Building2,
}

export function DashboardPage() {
  const { user } = useAuth()
  const can = useCan()
  const first = useMemo(() => { const date = new Date(); date.setDate(1); return localDate(date) }, [])
  const [from, setFrom] = useState(first)
  const [to, setTo] = useState(() => localDate(new Date()))
  const [data, setData] = useState<DashboardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    try {
      const response = await api.get<ApiEnvelope<DashboardResponse> | DashboardResponse>('/api/dashboard', { from, to }, signal)
      setData(unwrap(response))
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      setError(reason instanceof Error ? reason.message : 'Unable to load the dashboard.')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [from, to])

  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort() }, [load])

  const canReport = can('analytics.view')
  const [reporting, setReporting] = useState<AnalyticsResponse | null>(null)
  const [reportingLoading, setReportingLoading] = useState(canReport)
  const [reportingError, setReportingError] = useState('')

  // Reporting is a separate endpoint behind its own permission, so it loads
  // independently and a failure here never blanks the rest of the overview.
  const loadReporting = useCallback(async (signal?: AbortSignal) => {
    if (!canReport) return
    setReportingLoading(true)
    setReportingError('')
    try {
      try {
        const response = await api.get<ApiEnvelope<AnalyticsResponse> | AnalyticsResponse>('/api/analytics', { from, to }, signal)
        setReporting(unwrap(response))
      } catch (reason) {
        if (!(reason instanceof ApiError) || reason.status !== 404) throw reason
        const response = await api.get<ApiEnvelope<AnalyticsResponse> | AnalyticsResponse>('/api/time/summary', { from, to }, signal)
        setReporting(unwrap(response))
      }
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      setReportingError(reason instanceof Error ? reason.message : 'Unable to load analytics.')
    } finally {
      if (!signal?.aborted) setReportingLoading(false)
    }
  }, [canReport, from, to])

  useEffect(() => { const controller = new AbortController(); void loadReporting(controller.signal); return () => controller.abort() }, [loadReporting])

  const reportEntries = reporting?.entries ?? reporting?.sessions ?? []
  const reportTimeline: AnalyticsRow[] = (reporting?.timeline ?? []).map((row) => ({
    name: `${row.count ?? 0} logged ${row.count === 1 ? 'entry' : 'entries'}`,
    minutes: row.minutes,
    created_at: row.date,
  }))
  const reportRecords = reportEntries.length ? reportEntries : reportTimeline
  const reportTotal = reporting?.totals?.minutes ?? reporting?.totals?.total_minutes ?? reporting?.total_minutes ?? reporting?.range_minutes
    ?? reportRecords.reduce((sum, row) => sum + Number(row.minutes ?? row.time_minutes ?? row.worked_minutes ?? 0), 0)
  const reportCount = reporting?.totals?.entries ?? reportEntries.length
  const byProject = reporting?.byProject ?? reporting?.by_project ?? []
  const byUser = reporting?.byUser ?? reporting?.by_user ?? []
  const reportAverage = reportCount ? Math.round(reportTotal / reportCount) : 0

  const counts = data?.counts ?? {}
  const cards = [
    { label: 'My tasks', value: counts.myTasks ?? counts.my_tasks ?? 0, to: '/tasks?mine=1', icon: 'task', permission: 'tasks.view' },
    { label: 'Unread messages', value: counts.unreadMessages ?? counts.unread_messages ?? 0, to: '/messages?scope=unread', icon: 'inbox', permission: 'messages.view' },
    { label: 'Open projects', value: counts.activeProjects ?? counts.active_projects ?? counts.open_projects ?? 0, to: '/projects', icon: 'briefcase', permission: 'projects.view' },
    { label: 'Active clients', value: counts.activeClients ?? counts.active_clients ?? 0, to: '/clients', icon: 'building', permission: 'clients.view' },
  ].filter((card) => can(card.permission))
  const projectRows = data?.project_chart ?? data?.time?.byProject ?? data?.time?.by_project ?? []
  const clientRows = data?.client_chart ?? []
  const entries = data?.entries ?? []
  const teamTime = data?.teamTime ?? data?.team_time
  const hasTimeSummary = data != null && (data.today_minutes !== undefined || data.range_minutes !== undefined || data.time !== undefined)

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Overview"
        title={`Welcome back, ${user?.firstName ?? user?.first_name ?? user?.username ?? 'there'}.`}
        description="Here’s the clearest view of what needs your attention."
        actions={can('tasks.view') && can('time.track') ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="dashboard-from" className="text-xs text-muted-foreground">From</Label>
              <Input id="dashboard-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-8" />
            </div>
            <span className="pb-2 text-muted-foreground">→</span>
            <div className="space-y-1">
              <Label htmlFor="dashboard-to" className="text-xs text-muted-foreground">To</Label>
              <Input id="dashboard-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} className="h-8" />
            </div>
          </div>
        ) : undefined}
      />
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {!!cards.length && (
        <div className={cn('grid gap-3', cards.length >= 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : cards.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
          {cards.map((card) => {
            const CardIcon = CARD_ICON[card.icon] ?? SquareCheck
            return (
              <Link key={card.label} to={card.to}>
                <Card className="h-full transition-colors hover:bg-accent/50">
                  <CardContent className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm text-muted-foreground">{card.label}</p>
                      <strong className="text-2xl">{loading ? '—' : card.value}</strong>
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">View details <ArrowRight className="size-3" /></p>
                    </div>
                    <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground"><CardIcon className="size-4" /></span>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}

      {hasTimeSummary && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Panel>
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Time logged today</span>
            <strong className="block text-2xl">{loading ? '—' : <Minutes value={data?.today_minutes ?? data?.time?.todayMinutes ?? data?.time?.today_minutes} />}</strong>
            <p className="text-sm text-muted-foreground">Time recorded through task notes.</p>
          </Panel>
          <Panel>
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Selected range</span>
            <strong className="block text-2xl">{loading ? '—' : <Minutes value={data?.range_minutes ?? data?.time?.weekMinutes ?? data?.time?.week_minutes} />}</strong>
            <p className="text-sm text-muted-foreground">{entries.length} logged {entries.length === 1 ? 'entry' : 'entries'} in view.</p>
          </Panel>
        </div>
      )}

      {can('time.view_team') && <TeamTimeWidget summary={teamTime} />}

      {((can('projects.view') && projectRows.length > 0) || (can('clients.view') && clientRows.length > 0)) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {can('projects.view') && projectRows.length > 0 && <Panel title="Time by project"><Donut rows={projectRows} label="Time by project" /></Panel>}
          {can('clients.view') && clientRows.length > 0 && <Panel title="Time by client"><Donut rows={clientRows} label="Time by client" /></Panel>}
        </div>
      )}

      {canReport && (
        <>
          {reportingError && <ErrorBanner message={reportingError} onRetry={() => void loadReporting()} />}

          <div className="grid gap-3 sm:grid-cols-3">
            <Panel>
              <span className="text-xs uppercase tracking-widest text-muted-foreground">Total logged</span>
              <strong className="block text-2xl">{reportingLoading ? '—' : <Minutes value={reportTotal} />}</strong>
              <p className="text-sm text-muted-foreground">One sum of time-entry or session records.</p>
            </Panel>
            <Panel>
              <span className="text-xs uppercase tracking-widest text-muted-foreground">Entries</span>
              <strong className="block text-2xl">{reportingLoading ? '—' : reportCount}</strong>
              <p className="text-sm text-muted-foreground">Records inside the selected range.</p>
            </Panel>
            <Panel>
              <span className="text-xs uppercase tracking-widest text-muted-foreground">Average entry</span>
              <strong className="block text-2xl">{reportingLoading ? '—' : <Minutes value={reportAverage} />}</strong>
              <p className="text-sm text-muted-foreground">Average duration per record.</p>
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Time by project"><TimeBarChart rows={byProject} label="Time by project" /></Panel>
            <Panel title="Time by person"><TimeBarChart rows={byUser} label="Time by person" /></Panel>
          </div>

          <Panel title="Time records">
            {reportingLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-10" />)}
              </div>
            ) : reportRecords.length ? (
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
                  {reportRecords.map((row, index) => (
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
        </>
      )}

      {!canReport && (entries.length > 0 || hasTimeSummary) && (
        <Panel title="Recent logged time">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-10" />)}
            </div>
          ) : entries.length ? (
            <div className="divide-y">
              {entries.slice(0, 10).map((entry) => {
                const body = (
                  <>
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><Clock className="size-4" /></span>
                    <div className="min-w-0 flex-1">
                      <strong className="block truncate text-sm">{entry.task_title ?? entry.taskTitle ?? 'Task work'}</strong>
                      <span className="block truncate text-xs text-muted-foreground">{[entry.project_name ?? entry.projectName, entry.client_name ?? entry.clientName].filter(Boolean).join(' · ') || 'No project context'}</span>
                    </div>
                    <Minutes value={entry.time_minutes ?? entry.timeMinutes} />
                    <time className="w-20 shrink-0 text-right text-xs text-muted-foreground">{entry.created_at ?? entry.createdAt ? new Date((entry.created_at ?? entry.createdAt)!).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}</time>
                  </>
                )
                return can('tasks.view') && (entry.task_id ?? entry.taskId) ? (
                  <Link to={`/tasks/${entry.task_id ?? entry.taskId}`} key={entry.id} className="flex items-center gap-3 py-2.5 hover:bg-accent/50">{body}</Link>
                ) : (
                  <div key={entry.id} className="flex items-center gap-3 py-2.5">{body}</div>
                )
              })}
            </div>
          ) : <p className="text-sm text-muted-foreground">No time has been logged in this range.</p>}
        </Panel>
      )}
    </div>
  )
}
