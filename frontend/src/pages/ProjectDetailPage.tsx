import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { Avatar, ErrorBanner } from '@/components/shared'
import { ProjectTabStrip } from '@/components/forms/ProjectTabStrip'
import { MetricTile } from '@/components/kernix/metric-tile'
import { PanelSection } from '@/components/kernix/panel-section'
import { urgencyRail } from '@/components/kernix/rail'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { api, displayName, unwrap } from '@/lib/api'
import { healthDetail, healthOf, type PortfolioStats } from '@/lib/health'
import { useCan } from '@/lib/permissions'
import { dueMeta, formatMinutes, statusColor, urgencyColor } from '@/lib/taskSignals'
import { cn } from '@/lib/utils'
import type { ApiEnvelope, DashboardActivity, DashboardTask, EntityId, Project, ProjectForm, UserSummary } from '@/types/api'

type ProjectTab = 'overview' | 'tasks' | 'team' | 'activity'

function tabFromPath(pathname: string): ProjectTab {
  if (pathname.endsWith('/tasks')) return 'tasks'
  if (pathname.endsWith('/team')) return 'team'
  if (pathname.endsWith('/activity')) return 'activity'
  return 'overview'
}

interface TeamMember extends UserSummary {
  open_tasks: number
  logged_minutes: number
  is_manager: boolean
}

interface ProjectDetail extends Project {
  stats?: PortfolioStats
  open_tasks?: DashboardTask[]
  team?: TeamMember[]
  activity?: DashboardActivity[]
}

/**
 * One project: how far along it is, who is on it, and what has happened.
 *
 * Read-only, like the dashboard — rows navigate into the task list rather than
 * editing in place, because a project page that also edits tasks becomes a
 * second, worse task screen.
 */
export function ProjectDetailPage() {
  const { projectId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const can = useCan()
  const tab = tabFromPath(location.pathname)
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formsCount, setFormsCount] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    void api.get<ApiEnvelope<ProjectDetail>>(`/api/projects/${projectId}`)
      .then((response) => { if (active) setProject(unwrap(response)) })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Unable to load this project.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [projectId])

  // Only fetched to know whether the Forms tab should carry a count badge —
  // the tab itself is always offered regardless of permission or count.
  useEffect(() => {
    if (!projectId || !can('forms.view')) { setFormsCount(0); return }
    let active = true
    void api.get<ApiEnvelope<ProjectForm[]>>(`/api/projects/${projectId}/forms`)
      .then((response) => { if (active) setFormsCount(unwrap(response).length) })
      .catch(() => { if (active) setFormsCount(0) })
    return () => { active = false }
  }, [projectId, can])

  const stats = project?.stats
  const health = healthOf(stats?.health)
  const overBudget = stats?.budget_minutes != null && stats.logged_minutes > stats.budget_minutes

  const openTask = (id: EntityId) => navigate(`/tasks?open=${id}`)

  return (
    <div className="@container flex flex-col gap-3">
      <Button variant="ghost" size="sm" className="-ml-2 w-fit text-t3" asChild>
        <Link to="/projects"><ArrowLeft className="size-3.5" /> Projects</Link>
      </Button>

      {error && <ErrorBanner message={error} />}
      {loading && !project && <><Skeleton className="h-8 w-64" /><Skeleton className="h-24" /><Skeleton className="h-64" /></>}

      {project && stats && (
        <>
          <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-h1 text-title-strong">{project.name}</h1>
            <span className="text-body-lg text-t3">{project.client?.name}</span>
            <span className="flex-1" />
            <span aria-hidden="true" className="size-1.5 rounded-full" style={{ background: health.color }} />
            <span className="text-body-sm font-semibold" style={{ color: health.color }}>{health.label}</span>
            <span className="text-meta text-t4">{healthDetail(stats)}</span>
          </header>

          <div className="grid grid-cols-2 gap-2.5 @[660px]:grid-cols-4">
            <MetricTile label="Progress" value={`${stats.percent_complete}%`} note={`${stats.done} of ${stats.total} done`} />
            <MetricTile label="Open" value={stats.open} note={stats.unowned ? `${stats.unowned} unassigned` : ''} />
            <MetricTile label="Overdue" value={stats.overdue} note={stats.blocked ? `${stats.blocked} blocked` : ''} danger={stats.overdue > 0} />
            <MetricTile
              label="Tracked"
              value={formatMinutes(stats.logged_minutes) || '0m'}
              // Estimates are what the work was expected to take; a budget is
              // what it was sold as. They answer different questions.
              note={stats.budget_minutes != null
                ? `of ${formatMinutes(stats.budget_minutes)} budget`
                : stats.estimated_minutes ? `${formatMinutes(stats.estimated_minutes)} estimated` : ''}
              danger={overBudget}
            />
          </div>

          <ProjectTabStrip projectId={project.id} formsCount={formsCount} />

          {(tab === 'overview' || tab === 'tasks') && (
            <PanelSection
              label="Open work"
              meta={can('tasks.view') ? <Link className="text-meta text-t3 hover:text-t1" to={`/tasks?project_id=${project.id}`}>All tasks</Link> : undefined}
              empty={!project.open_tasks?.length && 'Nothing open on this project.'}
            >
              {project.open_tasks?.map((task) => {
                const due = dueMeta(task.due_date)
                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => openTask(task.id)}
                    className="-mx-2 flex items-center gap-2.5 rounded-md px-2 py-[7px] text-left hover:bg-elev-low"
                    style={urgencyRail(urgencyColor(task.urgency))}
                  >
                    <span aria-hidden="true" className="size-[7px] flex-none rounded-full" style={{ background: statusColor(task.status) }} />
                    <span className="min-w-0 flex-1 truncate text-body-lg text-title">{task.title}</span>
                    {task.assignee && <Avatar user={task.assignee} className="size-[22px]" />}
                    <span className={cn('flex-none whitespace-nowrap text-meta', due.className)}>{due.label}</span>
                  </button>
                )
              })}
            </PanelSection>
          )}

          {(tab === 'overview' || tab === 'team') && (
            <PanelSection label="Team" empty={!project.team?.length && 'Nobody is assigned yet.'}>
              <div className="flex flex-col gap-2.5">
                {project.team?.map((member) => (
                  <div key={member.id} className="flex items-center gap-2.5">
                    <Avatar user={member} className="size-[26px]" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-body-lg text-title">{displayName(member)}</span>
                      {member.is_manager && <span className="text-meta-sm text-t4">Project manager</span>}
                    </span>
                    <span className="flex-none text-right font-mono text-meta text-t3">
                      {formatMinutes(member.logged_minutes) || '0m'}
                      <span className="block text-[10.5px] text-t5">{member.open_tasks} open</span>
                    </span>
                  </div>
                ))}
              </div>
            </PanelSection>
          )}

          {(tab === 'overview' || tab === 'activity') && (
            <PanelSection label="Activity" empty={!project.activity?.length && 'Nothing has happened yet.'}>
              <div className="flex flex-col gap-3">
                {project.activity?.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-2.5">
                    <Avatar user={entry.user} className="size-[22px]" />
                    <span className="min-w-0 flex-1 text-body-sm leading-[1.45] text-[#a8a8b0] text-pretty">{entry.text}</span>
                  </div>
                ))}
              </div>
            </PanelSection>
          )}
        </>
      )}
    </div>
  )
}
