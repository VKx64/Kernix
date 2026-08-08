import { formatMinutes } from '@/lib/taskSignals'
import { cn } from '@/lib/utils'
import type { DashboardRetainer } from '@/types/api'

const WIDTH = 322
const HEIGHT = 96
/** Leaves room above the ceiling line for a burn that overshoots it. */
const TOP = 4

/**
 * Retainer burn: how much of the month's allowance has been used, against the
 * pace that would spend it exactly.
 *
 * The dashed diagonal is that ideal pace, so the answer is positional rather
 * than arithmetic — above the line is ahead of budget, below is behind. The
 * dotted continuation carries today's rate to month end, which is the number
 * worth acting on while there is still month left to act in.
 */
export function RetainerBurn({ retainer }: { retainer: DashboardRetainer }) {
  const { capacity_minutes: capacity, used_minutes: used, days_in_month: days, day_of_month: today } = retainer
  const over = retainer.projected_minutes > capacity

  const x = (day: number) => ((day - 1) / Math.max(1, days - 1)) * WIDTH
  const y = (minutes: number) => TOP + (1 - (capacity ? minutes / capacity : 0)) * (HEIGHT - TOP * 2)

  const actual = retainer.series.map((point) => `${x(point.day).toFixed(1)},${y(point.used_minutes).toFixed(1)}`)
  const pace = `${x(1).toFixed(1)},${y(0).toFixed(1)} ${x(days).toFixed(1)},${y(capacity).toFixed(1)}`
  const projected = `${x(today).toFixed(1)},${y(used).toFixed(1)} ${x(days).toFixed(1)},${y(retainer.projected_minutes).toFixed(1)}`
  const area = actual.length
    ? `M ${x(1).toFixed(1)},${(HEIGHT - TOP).toFixed(1)} L ${actual.join(' L ')} L ${x(today).toFixed(1)},${(HEIGHT - TOP).toFixed(1)} Z`
    : ''

  return (
    <div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        height={HEIGHT}
        preserveAspectRatio="none"
        className="my-3.5 block overflow-visible"
        role="img"
        aria-label={`${formatMinutes(used)} of ${formatMinutes(capacity)} used this month`}
      >
        {/* The allowance itself — everything below this line is within budget. */}
        <line x1="0" y1={TOP} x2={WIDTH} y2={TOP} stroke="var(--line-strong)" strokeWidth="1" strokeDasharray="2 4" />
        <polyline points={pace} fill="none" stroke="var(--t6)" strokeWidth="1.5" strokeDasharray="4 4" />
        {area && <path d={area} fill="color-mix(in srgb, var(--brand) 10%, transparent)" stroke="none" />}
        {actual.length > 1 && (
          <polyline
            points={actual.join(' ')}
            fill="none"
            stroke="var(--brand)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        <polyline points={projected} fill="none" stroke="var(--brand)" strokeWidth="1.5" strokeDasharray="3 4" opacity="0.55" />
        <circle cx={x(today)} cy={y(used)} r="3" fill="var(--brand)" />
      </svg>

      <div className="flex items-baseline gap-2 text-[11px] text-t5">
        <span>{retainer.month_label} 1</span>
        <span className="flex-1" />
        <span>{retainer.month_label} {days}</span>
      </div>

      <div className="mt-[11px] flex items-baseline gap-2 border-t border-soft pt-[11px]">
        <span className="text-body text-t3">Projected</span>
        <span className="flex-1" />
        <span className={cn('font-mono text-meta', over ? 'text-danger' : 'text-t2')}>
          {formatMinutes(retainer.projected_minutes)} of {formatMinutes(capacity)}
        </span>
      </div>

      <div className="mt-[11px] flex flex-col gap-[9px]">
        {retainer.clients.map((client) => {
          const percent = client.retainer_minutes
            ? Math.min(100, Math.round((client.used_minutes / client.retainer_minutes) * 100))
            : 0
          return (
            <div key={client.id} className="flex flex-col gap-[5px]">
              <span className="flex w-full items-baseline gap-2">
                <span className="truncate text-body-sm text-[#d4d4d9]">{client.name}</span>
                <span className="flex-1" />
                <span className={cn('flex-none font-mono text-meta', percent > 90 ? 'text-danger' : 'text-t3')}>
                  {formatMinutes(client.used_minutes) || '0m'} of {formatMinutes(client.retainer_minutes)}
                </span>
              </span>
              <span className="block h-0.5 w-full overflow-hidden rounded-[2px] bg-fill">
                <span
                  className={cn(
                    'block h-full rounded-[2px]',
                    percent > 90 ? 'bg-danger' : percent > 70 ? 'bg-warn' : 'bg-brand',
                  )}
                  style={{ width: `${percent}%` }}
                />
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
