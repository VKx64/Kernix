import { ApiError } from '../lib/api'
import { useWorkspace } from '../auth/WorkspaceProvider'
import { Icon } from './Icon'

export function isClockGate(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 409) return false
  const details = error.details as { code?: string } | undefined
  return details?.code === 'CLOCK_IN_REQUIRED'
    || details?.code === 'BREAK_ACTIVE'
    || /clock.?in|end your break/i.test(error.message)
}

export function ClockGate({ compact = false }: { compact?: boolean }) {
  const { timeAction, timeBusy, canAdminOverride, isOnBreak } = useWorkspace()
  return (
    <div className={`clock-gate ${compact ? 'compact' : ''}`}>
      <span className="clock-gate-icon"><Icon name="clock" /></span>
      <div>
        <strong>{isOnBreak ? 'End your break to make task changes' : 'Clock in to make task changes'}</strong>
        <p>{isOnBreak ? 'Task activity is paused while your break is active.' : 'Task updates and logged note time are tied to an active work session.'}</p>
      </div>
      <button className="btn btn-primary" disabled={timeBusy} onClick={() => void timeAction(isOnBreak ? 'break-end' : 'clock-in')}>
        <Icon name="play" size={16} /> {isOnBreak ? 'End break' : 'Clock in'}
      </button>
      {canAdminOverride && <span className="admin-override-note">Admin override is available in task forms.</span>}
    </div>
  )
}
