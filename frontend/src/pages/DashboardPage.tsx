import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { Avatar, ErrorBanner, Minutes, PageHeader, Panel } from '../components/ui'
import { Icon } from '../components/Icon'
import { api, displayName, unwrap } from '../lib/api'
import { useCan } from '../lib/permissions'
import type { ApiEnvelope, DashboardData, EntityId, TeamTimeSummary } from '../types/api'

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

function localDate(date: Date) {
  return new Intl.DateTimeFormat('en-CA').format(date)
}

function Donut({ rows, label }: { rows: Array<{ name: string; minutes: number; color?: string }>; label: string }) {
  // Reads the live theme tokens so the donut matches the rest of the palette in
  // both light and dark, instead of carrying its own near-miss purples.
  const colors = ['var(--primary)', 'var(--blue)', 'var(--success)', 'var(--warning)', 'var(--primary-strong)', 'var(--danger)']
  const total = rows.reduce((sum, row) => sum + Number(row.minutes || 0), 0)
  if (!rows.length || total <= 0) return <div className="chart-empty">No logged time in this range.</div>
  return (
    <div className="donut-layout">
      <div className="donut" aria-label={label}>
        <svg viewBox="0 0 42 42">
          <circle cx="21" cy="21" r="15.9" fill="none" stroke="var(--surface-3)" strokeWidth="6" />
          {rows.map((row, index) => {
            const value = Number(row.minutes || 0) / total * 100
            const offset = rows.slice(0, index).reduce((sum, previous) => sum + Number(previous.minutes || 0) / total * 100, 0)
            return <circle key={`${row.name}-${index}`} cx="21" cy="21" r="15.9" fill="none" stroke={row.color || colors[index % colors.length]} strokeDasharray={`${value} ${100 - value}`} strokeDashoffset={-offset} strokeWidth="6" />
          })}
        </svg>
        <div><strong><Minutes value={total} /></strong><span>Total</span></div>
      </div>
      <div className="chart-legend">
        {rows.slice(0, 6).map((row, index) => <div key={`${row.name}-${index}`}><span style={{ background: row.color || colors[index % colors.length] }} /><b>{row.name}</b><Minutes value={row.minutes} /></div>)}
      </div>
    </div>
  )
}

function TeamTimeWidget({ summary }: { summary?: TeamTimeSummary }) {
  const sessions = summary?.sessions ?? []
  const clockedIn = summary?.clockedInCount ?? summary?.clocked_in_count ?? sessions.length
  const working = summary?.workingCount ?? summary?.working_count ?? sessions.filter((session) => (session.state ?? session.status) !== 'break').length
  const breaks = summary?.onBreakCount ?? summary?.on_break_count ?? sessions.filter((session) => (session.state ?? session.status) === 'break').length
  return <Panel title="Team time now" className="team-time-panel"><div className="team-time-summary"><div><strong>{clockedIn}</strong><span>Clocked in</span></div><div><strong>{working}</strong><span>Working</span></div><div><strong>{breaks}</strong><span>On break</span></div></div>{sessions.length ? <div className="team-time-list">{sessions.map((session) => { const person = session.user ?? { id: session.userId ?? session.user_id ?? session.id ?? '', name: session.name }; const state = session.state ?? session.status ?? (session.currentBreakStartedAt ?? session.current_break_started_at ? 'break' : 'working'); const started = session.clockInAt ?? session.clock_in_at ?? session.startedAt ?? session.started_at; return <div key={String(session.id ?? person.id)}><Avatar user={person} size={32} /><div><strong>{displayName(person)}</strong><span>{started ? `Since ${new Date(started).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Active session'}</span></div><StatusPill state={state} /></div> })}</div> : <div className="empty-inline">No one is clocked in right now.</div>}</Panel>
}

function StatusPill({ state }: { state: string }) {
  const label = state === 'break' ? 'On break' : 'Working'
  return <span className={`team-time-state ${state === 'break' ? 'break' : 'working'}`}>{label}</span>
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

  const counts = data?.counts ?? {}
  const cards = [
    { label: 'My tasks', value: counts.myTasks ?? counts.my_tasks ?? 0, to: '/tasks?mine=1', icon: 'task' as const, tone: 'purple', permission: 'tasks.view' },
    { label: 'Unread messages', value: counts.unreadMessages ?? counts.unread_messages ?? 0, to: '/messages?scope=unread', icon: 'inbox' as const, tone: 'blue', permission: 'messages.view' },
    { label: 'Open projects', value: counts.activeProjects ?? counts.active_projects ?? counts.open_projects ?? 0, to: '/projects', icon: 'briefcase' as const, tone: 'mint', permission: 'projects.view' },
    { label: 'Active clients', value: counts.activeClients ?? counts.active_clients ?? 0, to: '/clients', icon: 'building' as const, tone: 'amber', permission: 'clients.view' },
  ].filter((card) => can(card.permission))
  const projectRows = data?.project_chart ?? data?.time?.byProject ?? data?.time?.by_project ?? []
  const clientRows = data?.client_chart ?? []
  const entries = data?.entries ?? []
  const teamTime = data?.teamTime ?? data?.team_time
  const hasTimeSummary = data != null && (data.today_minutes !== undefined || data.range_minutes !== undefined || data.time !== undefined)

  return (
    <div className="dashboard-page">
      <PageHeader eyebrow="Overview" title={`Welcome back, ${user?.firstName ?? user?.first_name ?? user?.username ?? 'there'}.`} description="Here’s the clearest view of what needs your attention." actions={can('tasks.view') && can('time.track') ?
        <div className="date-range"><label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><span>→</span><label>To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label></div>
      : undefined} />
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {!!cards.length && <div className={`metric-grid metric-grid-${Math.min(cards.length, 4)}`}>
        {cards.map((card) => <Link className={`metric-card tone-${card.tone}`} key={card.label} to={card.to}><span className="metric-card-icon"><Icon name={card.icon} /></span><div><small>{card.label}</small><strong>{loading ? '—' : card.value}</strong><span>View details →</span></div></Link>)}
      </div>}
      {hasTimeSummary && <div className="time-summary-grid">
        <Panel className="time-tile"><span className="eyebrow">Time logged today</span><strong>{loading ? '—' : <Minutes value={data?.today_minutes ?? data?.time?.todayMinutes ?? data?.time?.today_minutes} />}</strong><p>Time recorded through task notes.</p></Panel>
        <Panel className="time-tile"><span className="eyebrow">Selected range</span><strong>{loading ? '—' : <Minutes value={data?.range_minutes ?? data?.time?.weekMinutes ?? data?.time?.week_minutes} />}</strong><p>{entries.length} logged {entries.length === 1 ? 'entry' : 'entries'} in view.</p></Panel>
      </div>}
      {can('time.view_team') && <TeamTimeWidget summary={teamTime} />}
      {((can('projects.view') && projectRows.length > 0) || (can('clients.view') && clientRows.length > 0)) && <div className="chart-grid">
        {can('projects.view') && projectRows.length > 0 && <Panel title="Time by project"><Donut rows={projectRows} label="Time by project" /></Panel>}
        {can('clients.view') && clientRows.length > 0 && <Panel title="Time by client"><Donut rows={clientRows} label="Time by client" /></Panel>}
      </div>}
      {(entries.length > 0 || hasTimeSummary) && <Panel title="Recent logged time" action={can('analytics.view') ? <Link className="text-link" to="/analytics">Open analytics →</Link> : undefined}>
        {loading ? <div className="panel-loading"><span className="spinner" /> Loading activity…</div> : entries.length ? (
          <div className="activity-list">
            {entries.slice(0, 10).map((entry) => (
              can('tasks.view') && (entry.task_id ?? entry.taskId) ? <Link to={`/tasks/${entry.task_id ?? entry.taskId}`} key={entry.id}>
                <span className="activity-icon"><Icon name="clock" size={17} /></span>
                <div><strong>{entry.task_title ?? entry.taskTitle ?? 'Task work'}</strong><span>{[entry.project_name ?? entry.projectName, entry.client_name ?? entry.clientName].filter(Boolean).join(' · ') || 'No project context'}</span></div>
                <Minutes value={entry.time_minutes ?? entry.timeMinutes} />
                <time>{entry.created_at ?? entry.createdAt ? new Date((entry.created_at ?? entry.createdAt)!).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}</time>
              </Link> : <div className="activity-static" key={entry.id}><span className="activity-icon"><Icon name="clock" size={17} /></span><div><strong>{entry.task_title ?? entry.taskTitle ?? 'Task work'}</strong><span>{[entry.project_name ?? entry.projectName, entry.client_name ?? entry.clientName].filter(Boolean).join(' · ') || 'No project context'}</span></div><Minutes value={entry.time_minutes ?? entry.timeMinutes} /><time>{entry.created_at ?? entry.createdAt ? new Date((entry.created_at ?? entry.createdAt)!).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}</time></div>
            ))}
          </div>
        ) : <div className="empty-inline">No time has been logged in this range.</div>}
      </Panel>}
    </div>
  )
}
