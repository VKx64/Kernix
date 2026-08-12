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
      className="relative flex w-full flex-col rounded-[11px] border border-rail bg-surface"
      style={{ borderLeft: `2px solid ${health.color}` }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex flex-col gap-2.5 rounded-[11px] px-[17px] pb-[15px] pt-4 text-left hover:bg-elev-low/40"
      >
        {/* Right padding keeps the title and state pill clear of the actions,
            which float over the card rather than sitting in its flow. The
            worst case is three size-7 (28px) action buttons — sparkle, edit,
            delete — with two 4px gaps between them (92px), sitting at
            right-2.5 (10px) from the card edge: 102px, minus the button's
            own 17px right padding, needs at least 85px reserved. pr-24
            (96px) is the nearest real Tailwind step above that. If a fourth
            action button is ever added to this cluster, this needs to grow
            too. min-h-5 keeps the row's height at the state pill's 20px
            even when there's no pill, so the actions offset below (derived
            for a 20px row) stays correct either way. */}
        <div className={cn('flex min-h-5 items-center gap-2.5', actions && 'pr-24')}>
          <span className="min-w-0 flex-1 truncate text-title text-t1">{name}</span>
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

      {/* Unlike ClientTile, the header row here has no fixed-height element
          like a Monogram to anchor to: `text-title` (13.5px / 1.3 line-height
          ≈ 17.6px) is shorter than the optional state pill's h-5 (20px), so
          without a floor the row's height would depend on whether a project
          has a state label. min-h-5 above pins it at 20px either way. The
          action buttons are size-7 (28px), taller than that 20px row, so
          matching top offsets like ClientTile does would not centre them —
          it needs an explicit offset: pt-4 (16px) to the row's top, plus
          half the 8px height difference, giving top-3 (12px). */}
      {actions && <div className="absolute right-2.5 top-3">{actions}</div>}
    </div>
  )
}
