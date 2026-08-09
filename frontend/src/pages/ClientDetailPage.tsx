import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { Avatar, ErrorBanner } from '@/components/shared'
import { MetricTile } from '@/components/kernix/metric-tile'
import { Monogram } from '@/components/kernix/monogram'
import { PanelSection } from '@/components/kernix/panel-section'
import { ProjectCard } from '@/components/portfolio/ProjectCard'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { api, unwrap } from '@/lib/api'
import { healthOf, type PortfolioStats } from '@/lib/health'
import { formatMinutes } from '@/lib/taskSignals'
import { cn } from '@/lib/utils'
import type { ApiEnvelope, Client, Contact, DashboardActivity, EntityId } from '@/types/api'
import type { ClientStats } from '@/components/portfolio/ClientTile'

interface ClientProject {
  id: EntityId
  name: string
  stats: PortfolioStats
}

interface ClientDetail extends Client {
  stats?: ClientStats
  projects?: ClientProject[]
  contacts?: Contact[]
  activity?: DashboardActivity[]
}

/**
 * One client: how their delivery is going, and who to talk to.
 *
 * Money stays absent here as it does on the tile. The retainer is hours
 * against a monthly allowance, and the numbers that lead are about whether
 * their work is on time.
 */
export function ClientDetailPage() {
  const { clientId } = useParams()
  const navigate = useNavigate()
  const [client, setClient] = useState<ClientDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    void api.get<ApiEnvelope<ClientDetail>>(`/api/clients/${clientId}`)
      .then((response) => { if (active) setClient(unwrap(response)) })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Unable to load this client.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [clientId])

  const stats = client?.stats
  const health = healthOf(stats?.health)
  const retainer = stats?.retainer_minutes ?? null
  const used = stats?.retainer_used_minutes ?? 0
  const percent = retainer ? Math.min(100, Math.round((used / retainer) * 100)) : 0

  return (
    <div className="@container flex flex-col gap-3">
      <Button variant="ghost" size="sm" className="-ml-2 w-fit text-t3" asChild>
        <Link to="/clients"><ArrowLeft className="size-3.5" /> Clients</Link>
      </Button>

      {error && <ErrorBanner message={error} />}
      {loading && !client && <><Skeleton className="h-8 w-64" /><Skeleton className="h-24" /><Skeleton className="h-64" /></>}

      {client && stats && (
        <>
          <header className="flex flex-wrap items-center gap-3">
            <Monogram name={client.name} color={health.color} size="lg" />
            <span className="flex min-w-0 flex-col">
              <h1 className="text-h1 text-title-strong">{client.name}</h1>
              <span className="text-body-lg text-t3">
                {[client.website, client.email].filter(Boolean).join(' · ') || 'No contact detail'}
              </span>
            </span>
            <span className="flex-1" />
            <span className="text-body-sm font-semibold" style={{ color: health.color }}>{health.label}</span>
          </header>

          <div className="grid grid-cols-2 gap-2.5 @[660px]:grid-cols-4">
            <MetricTile label="Projects" value={stats.projects} note={`${stats.open_tasks} open tasks`} />
            <MetricTile label="Overdue" value={stats.overdue} note={stats.blocked ? `${stats.blocked} blocked` : ''} danger={stats.overdue > 0} />
            <MetricTile label="Tracked" value={formatMinutes(stats.logged_minutes) || '0m'} note="all time" />
            {retainer !== null && (
              <MetricTile
                label="Retainer"
                value={`${percent}%`}
                note={`${formatMinutes(used) || '0m'} of ${formatMinutes(retainer)} this month`}
                danger={percent > 90}
              />
            )}
          </div>

          <div className="grid grid-cols-1 items-start gap-3 @[880px]:grid-cols-[minmax(0,1fr)_minmax(280px,320px)]">
            <PanelSection label="Projects" empty={!client.projects?.length && 'No projects for this client yet.'}>
              <div className="grid gap-2.5 @[620px]:grid-cols-2">
                {client.projects?.map((project) => (
                  <ProjectCard
                    key={project.id}
                    name={project.name}
                    stats={project.stats}
                    team={[]}
                    onOpen={() => navigate(`/projects/${project.id}`)}
                  />
                ))}
              </div>
            </PanelSection>

            <div className="flex min-w-0 flex-col gap-3">
              <PanelSection label="Contacts" empty={!client.contacts?.length && 'No contacts recorded.'}>
                <div className="flex flex-col gap-2.5">
                  {client.contacts?.map((contact) => (
                    <div key={contact.id} className="flex min-w-0 flex-col">
                      <span className="truncate text-body-lg text-title">
                        {[contact.firstName ?? contact.first_name, contact.lastName ?? contact.last_name].filter(Boolean).join(' ') || contact.email}
                      </span>
                      <span className="truncate text-meta text-t4">
                        {[contact.title, contact.email, contact.phone1 ?? contact.phone_1].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                  ))}
                </div>
              </PanelSection>

              {stats.owner && (
                <PanelSection label="Account owner">
                  <div className="flex items-center gap-2.5">
                    <Avatar user={stats.owner} className="size-[26px]" />
                    <span className={cn('truncate text-body-lg text-title')}>
                      {[stats.owner.first_name, stats.owner.last_name].filter(Boolean).join(' ')}
                    </span>
                  </div>
                </PanelSection>
              )}

              <PanelSection label="Activity" empty={!client.activity?.length && 'Nothing has happened yet.'}>
                <div className="flex flex-col gap-3">
                  {client.activity?.map((entry) => (
                    <div key={entry.id} className="flex items-start gap-2.5">
                      <Avatar user={entry.user} className="size-[22px]" />
                      <span className="min-w-0 flex-1 text-body-sm leading-[1.45] text-[#a8a8b0] text-pretty">{entry.text}</span>
                    </div>
                  ))}
                </div>
              </PanelSection>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
