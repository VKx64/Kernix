import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { HourChart } from '@/components/timer/HourChart'
import { formatMinutes } from '@/lib/taskSignals'
import type { Timer } from '@/lib/useTimer'
import { cn } from '@/lib/utils'
import { BREAK_KINDS } from '@/types/api'

/** `01:12:04` — the working clock, which is read in hours. */
function hms(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const parts = [Math.floor(safe / 3600), Math.floor((safe % 3600) / 60), safe % 60]
  return parts.map((part) => String(part).padStart(2, '0')).join(':')
}

/** `12:04` — a break is short enough that the hour would be noise. */
function ms(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

function clockTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/**
 * The timer, and the day it is filling in.
 *
 * It lives in the sidebar rather than on the task screen because tracking
 * outlives whatever page you are on — you can be on a client, in Messages, or
 * reading the dashboard while the clock runs. Pressing the row while tracking
 * navigates to the task being tracked, so the timer is also the way back to
 * the work.
 *
 * The whole box takes the colour of its state: green while working, amber on
 * a break, and no border at all when idle, so a glance at the sidebar answers
 * whether anything is being recorded.
 */
export function TimerBox({ timer }: { timer: Timer }) {
  const navigate = useNavigate()
  const { state, task, seconds, busy } = timer
  const working = state === 'working'
  const onBreak = state === 'break'
  const over = timer.overBy > 0

  const label = onBreak
    ? timer.breakKind ?? 'Break'
    : working
      ? task?.title ?? 'Tracking'
      : 'Not tracking'

  // Idle, the clock has no run to report, so it reports the day instead.
  const clock = onBreak ? ms(seconds) : working ? hms(seconds) : formatMinutes(timer.todayMinutes) || '0m'

  const dueLabel = !onBreak
    ? `${formatMinutes(timer.todayMinutes) || '0m'} today`
    : over
      ? `+${timer.overBy}m over`
      : timer.breakDueAt
        ? `back ~${clockTime(timer.breakDueAt)}`
        : 'open-ended'

  const handleRow = () => {
    if (state === 'idle') return void timer.start(null)
    if (task) navigate(`/tasks?task=${task.id}`)
  }

  const handleStop = async () => {
    const logged = await timer.stop()
    if (!logged?.minutes) return
    toast(`Logged ${formatMinutes(logged.minutes)}${logged.task ? ` to ${logged.task.title}` : ''}`)
  }

  return (
    <div
      className={cn(
        'relative flex flex-col rounded-[9px] border transition-colors group-data-[collapsible=icon]:hidden',
        onBreak && 'border-warn/30 bg-warn/[0.07]',
        working && 'border-good/20 bg-inset',
        state === 'idle' && 'border-transparent',
      )}
    >
      <div className="px-2.5 pt-[9px]">
        <HourChart hours={timer.hours} mode={state} />
      </div>

      <button
        type="button"
        onClick={handleRow}
        className="flex h-8 items-center gap-[9px] rounded-md px-2 text-left hover:bg-sidebar-accent"
      >
        {/* The ring is the only glow in the app, and it is what makes a running
            timer visible from the corner of the eye. */}
        <span
          aria-hidden="true"
          className={cn(
            'size-1.5 flex-none rounded-full',
            onBreak && 'bg-warn shadow-[0_0_0_3px_color-mix(in_srgb,var(--warn)_14%,transparent)]',
            working && 'bg-good shadow-[0_0_0_3px_color-mix(in_srgb,var(--good)_14%,transparent)]',
            state === 'idle' && 'bg-t5',
          )}
        />
        <span
          className={cn(
            'flex-1 truncate text-[12px]',
            onBreak ? 'text-warn' : working ? 'text-t1' : 'text-t3',
          )}
        >
          {label}
        </span>
        <span
          className={cn(
            'flex-none font-mono text-[11.5px]',
            over ? 'text-danger' : onBreak ? 'text-warn' : working ? 'text-t1' : 'text-t4',
          )}
        >
          {clock}
        </span>
      </button>

      {onBreak && (
        <span className="block truncate pb-[5px] pl-[23px] pr-[9px] text-[11px] text-t4">
          {task?.title ?? 'Session'} paused · {hms(timer.pausedSeconds)}
        </span>
      )}

      {state !== 'idle' && (
        <div className="flex items-center gap-[5px] px-[7px] pb-[7px]">
          {onBreak ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void timer.resume()}
              className="inline-flex h-[25px] items-center rounded-sm bg-t1 px-2.5 text-[11.5px] font-semibold text-bg hover:brightness-110 disabled:opacity-60"
            >
              Resume
            </button>
          ) : (
            <DropdownMenu open={timer.breakMenuOpen} onOpenChange={timer.setBreakMenuOpen}>
              <DropdownMenuTrigger
                disabled={busy}
                className="inline-flex h-[25px] items-center rounded-sm bg-warn/15 px-2.5 text-[11.5px] font-semibold text-warn hover:brightness-110 disabled:opacity-60"
              >
                Break
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" sideOffset={6} className="min-w-[200px] p-[5px]">
                <DropdownMenuLabel className="px-2 pb-[5px] pt-[5px] text-label uppercase text-t4">
                  Take a break
                </DropdownMenuLabel>
                {BREAK_KINDS.map(({ kind, minutes }) => (
                  <DropdownMenuItem
                    key={kind}
                    onSelect={() => void timer.takeBreak(kind, minutes)}
                    className="h-7 gap-2 rounded-sm px-2 text-body-sm text-[#d4d4d9]"
                  >
                    <span className="flex-1 text-left">{kind}</span>
                    <span className="flex-none font-mono text-[11px] text-t4">{minutes ? `${minutes}m` : '—'}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => void handleStop()}
            className="inline-flex h-[25px] items-center rounded-sm bg-line-soft px-[9px] text-[11.5px] font-medium text-t2 hover:bg-line-strong disabled:opacity-60"
          >
            Stop
          </button>

          <span className="flex-1" />

          <span
            className={cn(
              'whitespace-nowrap',
              onBreak ? 'text-[11px]' : 'font-mono text-[10.5px]',
              over ? 'text-danger' : onBreak ? 'text-t4' : 'text-t5',
            )}
          >
            {dueLabel}
          </span>
        </div>
      )}
    </div>
  )
}
