import { formatMinutes } from '@/lib/taskSignals'
import { cn } from '@/lib/utils'
import type { DashboardWeekDay } from '@/types/api'

/** The tallest a bar can be, so a heavy day has somewhere to grow into. */
const SCALE_MINUTES = 540

/**
 * The week as seven columns, with the daily target drawn across them.
 *
 * The target is a dashed line rather than a filled goal because it is a
 * reference, not a score — a day under it is information, not a failure. Break
 * minutes cap the bar in amber above the work fill, the same way the sidebar's
 * hour chart splits an hour, so the two charts read as one idea at two scales.
 */
export function WeekChart({
  week,
  targetMinutes,
}: {
  week: DashboardWeekDay[]
  targetMinutes: number
}) {
  // Clamped so a target above the scale still lands inside the plot.
  const targetOffset = Math.min(96, (targetMinutes / SCALE_MINUTES) * 100)

  return (
    <div>
      <div className="relative mt-4 h-[104px]">
        <span
          aria-hidden="true"
          className="absolute inset-x-0 border-t border-dashed border-line-strong"
          style={{ bottom: `${targetOffset}%` }}
        />
        <span
          className="absolute right-0 font-mono text-[10px] text-t5"
          style={{ bottom: `calc(${targetOffset}% + 3px)` }}
        >
          {formatMinutes(targetMinutes)} target
        </span>
        <div className="absolute inset-0 flex items-end gap-[7px]">
          {week.map((day) => {
            const work = Math.min(100, (day.work_minutes / SCALE_MINUTES) * 100)
            const rest = Math.min(100 - work, (day.break_minutes / SCALE_MINUTES) * 100)
            const empty = day.work_minutes + day.break_minutes < 1
            return (
              <span
                key={day.date}
                title={`${day.label} · ${formatMinutes(day.work_minutes) || 'no time'}${day.break_minutes ? ` · ${formatMinutes(day.break_minutes)} break` : ''}`}
                className="flex h-full flex-1 flex-col justify-end gap-px"
              >
                <span
                  className="rounded-[2px] bg-warn/45"
                  style={{ display: rest > 0.6 ? 'block' : 'none', height: `${Math.max(4, rest)}%` }}
                />
                <span
                  className={cn(
                    'rounded-[2px] transition-[height] duration-[400ms] ease-out',
                    empty ? 'bg-rail' : day.is_today ? 'animate-live-pulse bg-good' : 'bg-good-dim',
                  )}
                  style={{ height: empty ? '3%' : `${Math.max(4, work)}%` }}
                />
              </span>
            )
          })}
        </div>
      </div>
      <div className="mt-[7px] flex gap-[7px]">
        {week.map((day) => (
          <span
            key={day.date}
            className={cn('flex-1 text-center text-[10.5px]', day.is_today ? 'text-t2' : 'text-t5')}
          >
            {day.label}
          </span>
        ))}
      </div>
    </div>
  )
}
