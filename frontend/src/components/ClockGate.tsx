import { ApiError } from '../lib/api'
import { useWorkspace } from '../auth/WorkspaceProvider'
import { Icon } from './Icon'

export function isClockGate(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 409) return false
  const details = error.details as { code?: string } | undefined
  return details?.code === 'CLOCK_IN_REQUIRED' || /clock.?in/i.test(error.message)
}

export function ClockGate({ compact = false }: { compact?: boolean }) {
  const { timeAction, timeBusy, canAdminOverride } = useWorkspace()
  return (
    <div className={`clock-gate ${compact ? 'compact' : ''}`}>
      <span className="clock-gate-icon"><Icon name="clock" /></span>
      <div>
        <strong>Clock in to make task changes</strong>
        <p>Task updates and logged note time are tied to an active work session.</p>
      </div>
      <button className="btn btn-primary" disabled={timeBusy} onClick={() => void timeAction('clock-in')}>
        <Icon name="play" size={16} /> Clock in
      </button>
      {canAdminOverride && <span className="admin-override-note">Admin override is available in task forms.</span>}
    </div>
  )
}
