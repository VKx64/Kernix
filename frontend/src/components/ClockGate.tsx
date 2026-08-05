import { useId } from 'react'
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

/**
 * `showOverride` is off inside modals: the switch belongs to the page gate, and
 * a modal opened from that page is already covered by it.
 */
export function ClockGate({ compact = false, showOverride = true }: { compact?: boolean; showOverride?: boolean }) {
  const { timeAction, timeBusy, canAdminOverride, isOnBreak, adminOverride, setAdminOverride } = useWorkspace()
  const tooltipId = useId()

  return (
    <div className={`clock-gate ${compact ? 'compact' : ''} ${adminOverride ? 'is-overridden' : ''}`.replace(/\s+/g, ' ').trim()}>
      <span className="clock-gate-icon"><Icon name="clock" /></span>
      <div>
        <strong>{isOnBreak ? 'End your break to make task changes' : 'Clock in to make task changes'}</strong>
        <p>{isOnBreak ? 'Task activity is paused while your break is active.' : 'Task updates and logged note time are tied to an active work session.'}</p>
      </div>
      <button className="btn btn-primary" disabled={timeBusy} onClick={() => void timeAction(isOnBreak ? 'break-end' : 'clock-in')}>
        <Icon name="play" size={16} /> {isOnBreak ? 'End break' : 'Clock in'}
      </button>
      {/* The only place the override is offered; it then applies workspace-wide. */}
      {canAdminOverride && showOverride && (
        <div className="clock-gate-override">
          <label>
            <input
              type="checkbox"
              aria-describedby={tooltipId}
              checked={adminOverride}
              onChange={(event) => setAdminOverride(event.target.checked)}
            />
            Work with administrator override
          </label>
          <span className="override-tooltip">
            <button className="override-tooltip-trigger" type="button" aria-label="About administrator override" aria-describedby={tooltipId}>?</button>
            <span className="override-tooltip-content" id={tooltipId} role="tooltip">Lets you make task changes without clocking in to an active work session. It stays on across the workspace until you switch it off or sign out. Use it for administrative corrections or exceptional changes.</span>
          </span>
        </div>
      )}
      {canAdminOverride && !showOverride && adminOverride && (
        <span className="admin-override-note">Administrator override is on for this session.</span>
      )}
    </div>
  )
}
