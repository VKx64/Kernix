import type { ReactNode } from 'react'
import { Avatar } from '@/components/shared'
import { healthDetail, healthOf, type PortfolioStats } from '@/lib/health'
import { formatMinutes } from '@/lib/taskSignals'
import { cn } from '@/lib/utils'
import type { UserSummary } from '@/types/api'

/**
 * A project as a card: health in the rail, progress in the bar, and the one
 * sentence that says whether anything is wrong.
 *
 * The rail is a 2px left border coloured by health, the same gesture the task
 * row uses for urgency, so a wall of cards can be scanned for trouble without
 * reading a word of it. Completion and health share a colour deliberately — a
 * bar that is 80% full and red says more than either signal alone.
 */
export function ProjectCard({
  name,
  stats,
  stateLabel,
  team,
  onOpen,
  actions,
}: {
  name: string
  stats: PortfolioStats
  /** Only set when the project is not simply active — "On hold", "Done". */
  stateLabel?: string
  team: UserSummary[]
  onOpen?: () => void
  /** The row menu, rendered outside the card's own click target. */
  actions?: ReactNode
}) {
  const health = healthOf(stats.health)
  const overBudget = stats.budget_minutes !== null && stats.logged_minutes > stats.budget_minutes

  return (
    <div
      className="relative flex flex-col rounded-[11px] border border-rail bg-surface"
      style={{ borderLeft: `2px solid ${health.color}` }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex flex-col gap-2.5 rounded-[11px] px-[17px] pb-[15px] pt-4 text-left hover:bg-elev-low/40"
      >
        <div className="flex items-center gap-2.5">
          <span className="min-w-0 flex-1 truncate text-card-title text-t1">{name}</span>
          {stateLabel && (
            <span className="inline-flex h-5 flex-none items-center rounded-md bg-[#1f1a12] px-2 text-[11px] font-[550] text-warn">
              {stateLabel}
            </span>
          )}
        </div>

        <div className="flex items-baseline gap-2">
          <span aria-hidden="true" className="size-1.5 flex-none rounded-full" style={{ background: health.color }} />
          <span className="text-body-sm font-semibold" style={{ color: health.color }}>
            {health.label}
          </span>
          <span className="truncate text-meta text-t4">{healthDetail(stats)}</span>
          <span className="flex-1" />
          <span className="flex-none font-mono text-meta text-t3">{stats.percent_complete}%</span>
        </div>

        <span className="block h-0.5 overflow-hidden rounded-[2px] bg-fill">
          <span
            className="block h-full rounded-[2px]"
            style={{ width: `${stats.percent_complete}%`, background: health.color }}
          />
        </span>

        <div className="flex items-center gap-2">
          <div className="flex flex-none items-center">
            {team.slice(0, 4).map((member, index) => (
              <Avatar
                key={member.id}
                user={member}
                className={cn('size-[22px] ring-2 ring-bg', index && '-ml-1.5')}
              />
            ))}
            {team.length > 4 && <span className="ml-[7px] text-[11px] text-t3">+{team.length - 4}</span>}
          </div>
          <span className="flex-1" />
          {/* Hidden rather than zeroed when a project has no budget: an empty
              "/ 0m" would read as a budget of nothing rather than none set. */}
          {stats.budget_minutes !== null && (
            <span className={cn('flex-none font-mono text-meta', overBudget ? 'text-danger' : 'text-t3')}>
              {formatMinutes(stats.logged_minutes) || '0m'} / {formatMinutes(stats.budget_minutes)}
            </span>
          )}
        </div>
      </button>

      {actions && <div className="absolute right-2.5 top-2.5">{actions}</div>}
    </div>
  )
}
