import { useNavigate, useSearchParams } from 'react-router'
import { Avatar, ErrorBanner } from '@/components/shared'
import { RetainerBurn } from '@/components/dashboard/RetainerBurn'
import { WeekChart } from '@/components/dashboard/WeekChart'
import { PanelSection } from '@/components/kernix/panel-section'
import { MetricTile } from '@/components/kernix/metric-tile'
import { Segmented } from '@/components/kernix/segmented'
import { Skeleton } from '@/components/ui/skeleton'
import { useDashboard } from '@/lib/useDashboard'
import { dayDiff, dueMeta, formatMinutes, railColor, statusRole, urgencyColor } from '@/lib/taskSignals'
import { cn } from '@/lib/utils'
import type { Dashboard, DashboardRange, DashboardTask } from '@/types/api'

const RANGES = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
] as const

function greeting(name: string, hour = new Date().getHours()): string {
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'
  return `Good ${part}${name ? `, ${name}` : ''}`
}

/** `Friday, 8 August` — the date as a person says it, not as a machine sorts it. */
function longDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
}

function dateLine(data: Dashboard): string {
  const parts = [longDate(data.date)]
  const due = data.metrics.due_today.count ?? 0
  const late = data.metrics.overdue.count ?? 0
  if (due) parts.push(`${due} due today`)
  if (late) parts.push(`${late} overdue`)
  if (!due && !late) parts.push('nothing due')
  return parts.join(' · ')
}

/**
 * The line under a focus row: the project, the status only when it is worth
 * saying, and the time already on the task.
 *
 * A status appears in lower case and only for work in flight or stuck —
 * "planning" or "quality check" under every row is noise the design leaves out,
 * and the workspace's own label is used so the vocabulary stays configurable.
 */
function taskMeta(task: DashboardTask): string {
  const role = statusRole(task.status)
  const logged = formatMinutes(task.logged_minutes)
  return [
    task.project,
    role === 'active' || role === 'blocked' ? task.status?.label?.toLowerCase() : null,
    logged && `${logged} logged`,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * The landing screen, and the only one that answers "what should I work on
 * right now" before it shows anything else.
 *
 * Everything here is read-only and scoped to the signed-in employee: rows
 * navigate to the task, nothing mutates, and no number describes anyone else's
 * work. The daily brief the design specifies is deliberately absent until
 * Oliver exists to write it — an empty accent panel would be worse than none.
 */
export function DashboardPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const range = (params.get('range') as DashboardRange) ?? 'today'
  const { data, loading, error, reload } = useDashboard(range)

  const setRange = (next: DashboardRange) => {
    const updated = new URLSearchParams(params)
    if (next === 'today') updated.delete('range')
    else updated.set('range', next)
    setParams(updated, { replace: true })
  }

  const openTask = (id: DashboardTask['id']) => navigate(`/tasks?open=${id}`)

  return (
    <>
      {error && <ErrorBanner message={error} onRetry={reload} />}

      {loading && !data && (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-7 w-64" />
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {[0, 1, 2, 3].map((tile) => <Skeleton key={tile} className="h-[92px]" />)}
          </div>
          <Skeleton className="h-64" />
        </div>
      )}

      {data && (
        // Container queries, not viewport ones: the design measures the content
        // column, which is the window minus a 236px sidebar that can collapse.
        <div className="@container flex flex-col gap-3">
          {/* The screen's own header, with its one control at the right —
              the design gives each section its top area rather than a bar
              above all of them. */}
          <header className="flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-h1 text-title-strong">{greeting(data.greeting_name)}</h1>
              <p className="mt-[3px] text-body-lg text-t3">{dateLine(data)}</p>
            </div>
            <Segmented label="Dashboard range" options={RANGES} value={range} onChange={setRange} />
          </header>

          <div className="grid grid-cols-2 gap-2.5 @[660px]:grid-cols-4">
            <MetricTile
              label="Due today"
              value={data.metrics.due_today.count ?? 0}
              note={data.metrics.due_today.note}
            />
            <MetricTile
              label="Overdue"
              value={data.metrics.overdue.count ?? 0}
              note={data.metrics.overdue.note}
              danger={(data.metrics.overdue.count ?? 0) > 0}
            />
            <MetricTile
              label="Tracked today"
              value={formatMinutes(data.metrics.tracked_today.minutes) || '0m'}
              note={data.metrics.tracked_today.note}
            />
            {data.metrics.retainer_burn && (
              <MetricTile
                label="Retainer burn"
                value={`${data.metrics.retainer_burn.percent ?? 0}%`}
                note={data.metrics.retainer_burn.note}
                danger={(data.metrics.retainer_burn.percent ?? 0) > 90}
              />
            )}
          </div>

          <div className="grid grid-cols-1 items-start gap-3 @[880px]:grid-cols-[minmax(0,1fr)_minmax(300px,352px)]">
            <div className="flex min-w-0 flex-col gap-3">
              <PanelSection
                label="Work on next"
                meta={data.focus.length ? 'ordered by urgency' : ''}
                empty={!data.focus.length && 'Nothing is waiting on you.'}
              >
                {data.focus.map((task, index) => {
                  const due = dueMeta(task.due_date)
                  return (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => openTask(task.id)}
                      className="-mx-2 flex w-full items-center gap-[11px] rounded-md px-2 py-[9px] text-left hover:bg-elev-low"
                    >
                      {/* The rail is an element rather than the row's own border:
                          it stops short of the row padding, which is what keeps
                          a list of five from reading as a striped block. */}
                      <span
                        aria-hidden="true"
                        className="w-0.5 flex-none self-stretch rounded-sm"
                        style={{ background: railColor(task.urgency) ?? 'var(--line-strong)' }}
                      />
                      <span
                        className={cn('flex-none font-mono text-[11px]', index === 0 ? 'text-t2' : 'text-t6')}
                      >
                        {String(task.rank).padStart(2, '0')}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-body leading-[normal] text-title">{task.title}</span>
                        <span className="truncate text-meta-sm leading-[normal] text-t4">{taskMeta(task)}</span>
                      </span>
                      <span
                        className={cn(
                          'flex-none whitespace-nowrap font-mono text-meta-sm',
                          due.tone === 'over' ? 'text-danger' : due.tone === 'today' ? 'text-warn' : 'text-t4',
                        )}
                      >
                        {due.label}
                      </span>
                    </button>
                  )
                })}
              </PanelSection>

              <PanelSection
                label="Needs attention"
                meta={
                  data.needs_attention.length
                    ? `${data.needs_attention.length} ${data.needs_attention.length === 1 ? 'item' : 'items'}`
                    : ''
                }
                empty={!data.needs_attention.length && 'Nothing is late, blocked or untouched.'}
              >
                {data.needs_attention.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => openTask(task.id)}
                    className="-mx-2 flex w-full items-start gap-2.5 rounded-md p-2 text-left hover:bg-elev-low"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-[5px] size-1.5 flex-none rounded-full"
                      style={{ background: task.reason === 'overdue' ? 'var(--danger)' : 'var(--warn)' }}
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-body leading-[normal] text-title">{task.title}</span>
                      <span
                        className={cn(
                          'truncate text-meta-sm leading-[normal]',
                          task.reason === 'overdue' ? 'text-danger' : 'text-warn',
                        )}
                      >
                        {task.why}
                      </span>
                    </span>
                    <span className="flex-none whitespace-nowrap text-meta-sm text-t4">{task.project}</span>
                  </button>
                ))}
              </PanelSection>

              <PanelSection
                label="Upcoming"
                meta="next 14 days"
                empty={!data.upcoming.length && 'Nothing due in the next fortnight.'}
              >
                {data.upcoming.map((day) => {
                  const soon = (dayDiff(day.date) ?? 99) <= 1
                  return (
                  <div key={day.date} className="grid grid-cols-[74px_minmax(0,1fr)] gap-3 border-t border-soft py-[7px]">
                    <span className={cn('pt-[3px] text-meta font-[550]', soon ? 'text-t2' : 'text-t4')}>{day.label}</span>
                    <span className="flex min-w-0 flex-col gap-[5px]">
                      {day.tasks.map((task) => (
                        <button
                          key={task.id}
                          type="button"
                          onClick={() => openTask(task.id)}
                          className="-mx-1.5 flex w-full items-center gap-2 rounded-sm px-1.5 py-0.5 hover:bg-elev-low"
                        >
                          <span
                            aria-hidden="true"
                            className="size-[5px] flex-none rounded-full"
                            style={{ background: urgencyColor(task.urgency) }}
                          />
                          <span className="min-w-0 flex-1 truncate text-left text-body-sm text-[#b8b8c0]">{task.title}</span>
                          <span className="flex-none whitespace-nowrap text-[11px] text-t4">{task.project}</span>
                        </button>
                      ))}
                    </span>
                  </div>
                  )
                })}
              </PanelSection>
            </div>

            <div className="flex min-w-0 flex-col gap-3">
              <PanelSection
                label="Tracked this week"
                meta={<span className="font-mono text-body text-t1">{formatMinutes(data.week_total_minutes) || '0m'}</span>}
              >
                <WeekChart week={data.week} targetMinutes={data.daily_target_minutes} />
                <WeekDelta
                  total={data.week_total_minutes}
                  lastWeek={data.last_week_total_minutes}
                />
              </PanelSection>

              {data.retainer && (
                <PanelSection label="Retainer burn" meta={data.retainer.month_label}>
                  <RetainerBurn retainer={data.retainer} />
                </PanelSection>
              )}

              <PanelSection label="Recent activity" empty={!data.activity.length && 'Nothing has happened yet today.'}>
                <div className="flex flex-col gap-3">
                  {data.activity.map((entry) => (
                    <div key={entry.id} className="flex items-start gap-2.5">
                      <Avatar user={entry.user} className="size-[22px]" />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-body-sm leading-[1.45] text-[#a8a8b0] text-pretty">{entry.text}</span>
                        <span className="text-[11px] text-t5">{relativeTime(entry.at)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </PanelSection>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function WeekDelta({ total, lastWeek }: { total: number; lastWeek: number }) {
  const delta = total - lastWeek
  return (
    <div className="mt-[11px] flex items-baseline gap-2 border-t border-soft pt-[11px]">
      <span className="whitespace-nowrap text-meta text-t3">
        {lastWeek ? 'vs last week' : 'no time logged last week'}
      </span>
      <span className="flex-1" />
      {lastWeek !== 0 && (
        <span className={cn('font-mono text-meta', delta < 0 ? 'text-warn' : 'text-good')}>
          {delta >= 0 ? '+' : '−'}{formatMinutes(Math.abs(delta)) || '0m'}
        </span>
      )}
    </div>
  )
}

/** Short relative time — the rail has no room for a full timestamp. */
function relativeTime(value: string): string {
  const at = new Date(value).getTime()
  if (Number.isNaN(at)) return ''
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'Yesterday' : `${days}d ago`
}
