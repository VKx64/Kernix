import { useId } from 'react'
import { CircleHelp, Clock, Play } from 'lucide-react'
import { useWorkspace } from '@/auth/WorkspaceProvider'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { ApiError } from '@/lib/api'
import { useTimerContext } from '@/lib/useTimer'

export function isClockGate(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 409) return false
  const details = error.details as { code?: string } | undefined
  return details?.code === 'CLOCK_IN_REQUIRED'
    || details?.code === 'BREAK_ACTIVE'
    || /clock.?in|end your break/i.test(error.message)
}

/**
 * `showOverride` is off inside modals: the switch belongs to the page gate, and
 * a modal opened from that page is already covered by it.
 */
export function ClockGate({ compact = false, showOverride = true }: { compact?: boolean; showOverride?: boolean }) {
  const { timeBusy, canAdminOverride, isOnBreak, adminOverride, setAdminOverride } = useWorkspace()
  const timer = useTimerContext()
  const tooltipId = useId()

  // Both actions go through the timer rather than the attendance endpoints:
  // a break holds a timer entry as well as an attendance break, and ending
  // only one of the two would leave the sidebar claiming you are still away.
  const unblock = () => void (isOnBreak ? timer.resume() : timer.start(null))

  return (
    <Card className={cn('gap-3', adminOverride && 'border-warning', !compact && 'py-4')}>
      <CardContent className="flex flex-wrap items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><Clock className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <strong className="block text-sm">{isOnBreak ? 'End your break to make task changes' : 'Start tracking to make task changes'}</strong>
          <p className="text-sm text-muted-foreground">{isOnBreak ? 'Task activity is paused while your break is active.' : 'Task updates and logged note time are tied to an active work session.'}</p>
        </div>
        <Button disabled={timeBusy || timer.busy} onClick={unblock}>
          <Play /> {isOnBreak ? 'End break' : 'Start tracking'}
        </Button>
        {/* The only place the override is offered; it then applies workspace-wide. */}
        {canAdminOverride && showOverride && (
          <div className="flex w-full flex-wrap items-center gap-2 border-t pt-3">
            <Checkbox
              id="admin-override"
              aria-describedby={tooltipId}
              checked={adminOverride}
              onCheckedChange={(checked) => setAdminOverride(checked === true)}
            />
            <Label htmlFor="admin-override" className="font-normal">Work with administrator override</Label>
            <span className="relative inline-flex">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="rounded-full"
                aria-label="About administrator override"
                aria-describedby={tooltipId}
              >
                <CircleHelp />
              </Button>
              <span id={tooltipId} role="tooltip" className="sr-only">
                Lets you make task changes without clocking in to an active work session. It stays on across the workspace until you switch it off or sign out. Use it for administrative corrections or exceptional changes.
              </span>
            </span>
          </div>
        )}
        {canAdminOverride && !showOverride && adminOverride && (
          <p className="w-full text-xs text-warning">Administrator override is on for this session.</p>
        )}
      </CardContent>
    </Card>
  )
}
