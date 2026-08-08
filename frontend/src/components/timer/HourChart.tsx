import { cn } from '@/lib/utils'
import type { TimerHourColumn } from '@/lib/useTimer'

/** 10am, 3pm — the way the hour reads in a tooltip rather than on a 24h clock. */
function hourName(hour: number): string {
  const display = hour > 12 ? hour - 12 : hour
  return `${display}${hour >= 12 ? 'pm' : 'am'}`
}

function columnTitle({ hour, workMinutes, breakMinutes }: TimerHourColumn): string {
  const work = workMinutes >= 1 ? `${Math.round(workMinutes)}m tracked` : 'no time'
  const rest = breakMinutes >= 1 ? `  ·  ${Math.round(breakMinutes)}m break` : ''
  return `${hourName(hour)}  ·  ${work}${rest}`
}

/**
 * The working day as ten columns, 9am to 6pm.
 *
 * Bar height is the fraction of the hour that was tracked, so a full hour
 * fills the column and the shape of the day is readable without any axis.
 * Break minutes cap the column in amber above the work fill rather than
 * sitting beside it — the hour is one unit of time, split two ways.
 *
 * An hour with nothing in it keeps a low neutral stub so the row still reads
 * as a chart of the whole day rather than a gap.
 */
export function HourChart({ hours, mode }: { hours: TimerHourColumn[]; mode: 'idle' | 'working' | 'break' }) {
  const tracked = Math.round(hours.reduce((total, hour) => total + hour.workMinutes, 0))

  return (
    <div
      className="flex h-7 items-end gap-[3px]"
      role="img"
      aria-label={tracked ? `${tracked} minutes tracked today` : 'No time tracked today'}
    >
      {hours.map((column) => {
        const empty = column.workMinutes + column.breakMinutes < 0.5
        const work = Math.min(100, (column.workMinutes / 60) * 100)
        const rest = Math.min(100 - work, (column.breakMinutes / 60) * 100)
        return (
          <span
            key={column.hour}
            title={columnTitle(column)}
            className="flex h-full flex-1 flex-col justify-end gap-px"
          >
            <span
              className={cn(
                'rounded-[2px] transition-[height] duration-[400ms] ease-out',
                column.live && mode === 'break' ? 'animate-live-pulse bg-warn' : 'bg-warn/45',
              )}
              style={{ display: rest > 0.6 ? 'block' : 'none', height: `${Math.max(7, rest)}%` }}
            />
            <span
              className={cn(
                'rounded-[2px] transition-[height] duration-[400ms] ease-out',
                empty ? 'bg-rail' : column.live && mode === 'working' ? 'animate-live-pulse bg-good' : 'bg-good-dim',
              )}
              style={{ height: empty ? '8%' : `${Math.max(7, work)}%` }}
            />
          </span>
        )
      })}
    </div>
  )
}
