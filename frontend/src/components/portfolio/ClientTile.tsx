import type { ReactNode } from 'react'
import { Avatar } from '@/components/shared'
import { Monogram } from '@/components/kernix/monogram'
import { healthOf, type Health } from '@/lib/health'
import { formatMinutes } from '@/lib/taskSignals'
import { cn } from '@/lib/utils'
import type { UserSummary } from '@/types/api'

export interface ClientStats {
  projects: number
  open_tasks: number
  overdue: number
  blocked: number
  logged_minutes: number
  retainer_minutes: number | null
  retainer_used_minutes: number | null
  health: Health
  owner?: UserSummary | null
}

/**
 * A client as a compact tile, leading with delivery health.
 *
 * Money is deliberately absent: the question a tile answers is whether this
 * client's work is in trouble, and an amount outstanding would answer a
 * different one louder. The retainer bar is hours against their monthly
 * allowance, which is the only budget this system holds.
 */
export function ClientTile({
  name,
  stats,
  onOpen,
  actions,
}: {
  name: string
  stats: ClientStats
  onOpen?: () => void
  actions?: ReactNode
}) {
  const health = healthOf(stats.health)
  const used = stats.retainer_used_minutes ?? 0
  const percent = stats.retainer_minutes ? Math.min(100, Math.round((used / stats.retainer_minutes) * 100)) : 0

  const footer = [
    `${stats.projects} ${stats.projects === 1 ? 'project' : 'projects'}`,
    `${stats.open_tasks} open`,
    stats.overdue ? `${stats.overdue} overdue` : null,
  ].filter(Boolean) as string[]

  return (
    <div
      className="relative flex flex-col rounded-[11px] border border-rail bg-surface"
      style={{ borderTop: `2px solid ${health.color}` }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex flex-col gap-2.5 rounded-[11px] px-3.5 pb-3 pt-3.5 text-left hover:bg-elev-low/40"
      >
        <div className="flex items-center gap-2.5">
          <Monogram name={name} color={health.color} size="md" />
          <span className="min-w-0 flex-1 truncate text-card-title text-t1">{name}</span>
          <span className="flex-none text-meta font-semibold" style={{ color: health.color }}>
            {health.label}
          </span>
        </div>

        {stats.retainer_minutes !== null && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline gap-2">
              <span className="text-meta text-t4">Retainer this month</span>
              <span className="flex-1" />
              <span className={cn('font-mono text-meta', percent > 90 ? 'text-danger' : 'text-t3')}>
                {formatMinutes(used) || '0m'} of {formatMinutes(stats.retainer_minutes)}
              </span>
            </div>
            <span className="block h-0.5 overflow-hidden rounded-[2px] bg-fill">
              <span
                className={cn('block h-full rounded-[2px]', percent > 90 ? 'bg-danger' : percent > 70 ? 'bg-warn' : 'bg-brand')}
                style={{ width: `${percent}%` }}
              />
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 border-t border-soft pt-2.5">
          <span className="min-w-0 flex-1 truncate text-meta text-t4">{footer.join(' · ')}</span>
          {stats.owner && <Avatar user={stats.owner} className="size-[22px]" />}
        </div>
      </button>

      {actions && <div className="absolute right-2 top-2">{actions}</div>}
    </div>
  )
}
