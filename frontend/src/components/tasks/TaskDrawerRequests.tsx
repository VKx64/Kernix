import { useState } from 'react'
import { LabelRow } from '@/components/kernix/label-row'
import { Avatar } from '@/components/shared'
import { api, displayName } from '@/lib/api'
import { formatMinutes } from '@/lib/taskSignals'
import { cn } from '@/lib/utils'
import type { EntityId, EstimateRequest, TaskWorkRequest } from '@/types/api'

/**
 * The drawer's REQUESTS section: asking for more time, and asking to work on
 * something you are not assigned to — plus the decisions on both.
 *
 * These were the last actions that forced the full page, and they are the two
 * a person hits mid-triage rather than mid-planning: the estimate runs out
 * while the work is open, and the request to pick a task up is made from the
 * list it was spotted in. Deciding is here for the same reason — a manager
 * reading the queue can answer without leaving it.
 */
export function TaskDrawerRequests({
  taskId,
  estimateRequests,
  workRequests,
  canRequestEstimate,
  canReviewWork,
  currentUserId,
  adminOverride = false,
  onChanged,
}: {
  taskId: EntityId
  estimateRequests: EstimateRequest[]
  workRequests: TaskWorkRequest[]
  /** Only the assignee may ask for more time, and only on a live task. */
  canRequestEstimate: boolean
  canReviewWork: boolean
  currentUserId?: EntityId
  adminOverride?: boolean
  onChanged: () => void | Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [estimateOpen, setEstimateOpen] = useState(false)
  const [minutes, setMinutes] = useState('30')
  const [reason, setReason] = useState('')
  const [declining, setDeclining] = useState<TaskWorkRequest | null>(null)
  const [declineReason, setDeclineReason] = useState('')

  const latestEstimate = estimateRequests[0] ?? null
  const myWorkRequest = workRequests.find(
    (request) => request.status === 'pending' && String(request.requester?.id ?? '') === String(currentUserId ?? ''),
  ) ?? null
  const toReview = canReviewWork ? workRequests.filter((request) => request.status === 'pending') : []

  // Nothing to ask and nothing to answer means no section at all, matching how
  // Files and Subtasks stay absent rather than showing an empty box.
  if (!canRequestEstimate && !latestEstimate && !myWorkRequest && toReview.length === 0) return null

  const run = async (operation: () => Promise<unknown>, fallback: string) => {
    if (busy) return false
    setBusy(true)
    setError('')
    try {
      await operation()
      await onChanged()
      return true
    } catch (reason_) {
      setError(reason_ instanceof Error ? reason_.message : fallback)
      return false
    } finally {
      setBusy(false)
    }
  }

  const requestMoreTime = async () => {
    const additional = Number(minutes)
    const why = reason.trim()
    if (!why || !Number.isFinite(additional) || additional < 1) return
    const okay = await run(
      () => api.post(`/api/tasks/${taskId}/estimate-requests`, {
        additional_minutes: Math.round(additional),
        reason: why,
        admin_override: adminOverride ? 1 : undefined,
      }),
      'That request could not be sent.',
    )
    if (okay) {
      setEstimateOpen(false)
      setReason('')
      setMinutes('30')
    }
  }

  const withdraw = (request: TaskWorkRequest) =>
    run(() => api.post(`/api/tasks/${taskId}/work-requests/${request.id}/withdraw`), 'That request could not be withdrawn.')

  const approve = (request: TaskWorkRequest) =>
    run(() => api.post(`/api/tasks/${taskId}/work-requests/${request.id}/approve`, {}), 'That request could not be approved.')

  const decline = async () => {
    if (!declining || !declineReason.trim()) return
    const okay = await run(
      () => api.post(`/api/tasks/${taskId}/work-requests/${declining.id}/decline`, { reason: declineReason.trim() }),
      'That request could not be declined.',
    )
    if (okay) {
      setDeclining(null)
      setDeclineReason('')
    }
  }

  const stopEscape = (event: React.KeyboardEvent) => {
    // The drawer closes on Escape at the window; a form cancelling itself must
    // not take the drawer with it.
    if (event.key === 'Escape') event.stopPropagation()
  }

  return (
    <section className="flex flex-col gap-[9px]">
      <div className="flex items-center gap-2.5">
        <LabelRow>Requests</LabelRow>
        <span className="flex-1" />
        {canRequestEstimate && !estimateOpen && (
          <button
            type="button"
            onClick={() => { setError(''); setEstimateOpen(true) }}
            className="inline-flex h-6 flex-none items-center gap-1 rounded-[7px] px-2 text-[11.5px] whitespace-nowrap text-t3 hover:bg-soft hover:text-t1"
          >
            Request more time
          </button>
        )}
      </div>

      {error && <p className="text-[11px] text-destructive">{error}</p>}

      {latestEstimate && (
        <div className="flex flex-wrap items-baseline gap-2 rounded-[7px] border border-line-soft p-2.5">
          <span className="text-body font-[550] text-[#d4d4d9]">
            {formatMinutes(
              Number(latestEstimate.requestedAdditionalMinutes ?? latestEstimate.requested_additional_minutes ?? 0),
            )} additional
          </span>
          <RequestStatus value={latestEstimate.status} />
          <span className="w-full text-meta text-t3">
            {latestEstimate.requestReason || latestEstimate.request_reason || 'No reason given.'}
          </span>
        </div>
      )}

      {canRequestEstimate && estimateOpen && (
        <div className="flex flex-col gap-1.5" onKeyDown={stopEscape}>
          <input
            autoFocus
            value={minutes}
            disabled={busy}
            inputMode="numeric"
            onChange={(event) => setMinutes(event.target.value)}
            aria-label="Additional minutes"
            placeholder="Additional minutes"
            className="h-8 rounded-[7px] border border-line bg-transparent px-2.5 text-body-lg text-t1 outline-none placeholder:text-t4 focus:border-line-strong"
          />
          <textarea
            value={reason}
            disabled={busy}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            aria-label="Why more time is needed"
            placeholder="Why the estimate needs to grow…"
            className="resize-none rounded-[7px] border border-line bg-transparent px-2.5 py-1.5 text-body-lg leading-[1.5] text-t1 outline-none placeholder:text-t4 focus:border-line-strong"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy || !reason.trim() || !(Number(minutes) >= 1)}
              onClick={() => void requestMoreTime()}
              className="h-7 rounded-[7px] bg-soft px-2.5 text-[11.5px] text-t1 disabled:opacity-40 hover:bg-line-soft"
            >
              Send request
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => { setEstimateOpen(false); setReason(''); setError('') }}
              className="h-7 rounded-[7px] px-2.5 text-[11.5px] text-t3 hover:bg-soft hover:text-t1"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {myWorkRequest && (
        <div className="flex flex-wrap items-baseline gap-2 rounded-[7px] border border-line-soft p-2.5">
          <span className="text-body font-[550] text-[#d4d4d9]">Your request to work on this</span>
          <RequestStatus value={myWorkRequest.status} />
          <button
            type="button"
            disabled={busy}
            onClick={() => void withdraw(myWorkRequest)}
            className="ml-auto text-meta-sm text-t4 hover:text-t1"
          >
            Withdraw
          </button>
          <span className="w-full text-meta text-t3">{myWorkRequest.reason}</span>
        </div>
      )}

      {toReview.map((request) => (
        <div key={String(request.id)} className="flex flex-col gap-1.5 rounded-[7px] border border-line-soft p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            {request.requester && <Avatar user={request.requester} className="size-[18px]" />}
            <span className="text-body font-[550] text-[#d4d4d9]">
              {request.requester ? displayName(request.requester) : 'Someone'}
            </span>
            <span className="text-meta text-t3">wants this task</span>
          </div>
          <span className="text-meta text-t3">{request.reason}</span>
          {declining && String(declining.id) === String(request.id) ? (
            <div className="flex flex-col gap-1.5" onKeyDown={stopEscape}>
              <input
                autoFocus
                value={declineReason}
                disabled={busy}
                onChange={(event) => setDeclineReason(event.target.value)}
                aria-label="Why this is declined"
                placeholder="Why it is declined…"
                className="h-8 rounded-[7px] border border-line bg-transparent px-2.5 text-body-lg text-t1 outline-none placeholder:text-t4 focus:border-line-strong"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy || !declineReason.trim()}
                  onClick={() => void decline()}
                  className="h-7 rounded-[7px] px-2.5 text-[11.5px] text-destructive disabled:opacity-40 hover:bg-soft"
                >
                  Confirm decline
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => { setDeclining(null); setDeclineReason('') }}
                  className="h-7 rounded-[7px] px-2.5 text-[11.5px] text-t3 hover:bg-soft hover:text-t1"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void approve(request)}
                className="h-7 rounded-[7px] bg-soft px-2.5 text-[11.5px] text-t1 disabled:opacity-40 hover:bg-line-soft"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => { setDeclining(request); setDeclineReason(''); setError('') }}
                className="h-7 rounded-[7px] px-2.5 text-[11.5px] text-t3 hover:bg-soft hover:text-t1"
              >
                Decline
              </button>
            </div>
          )}
        </div>
      ))}
    </section>
  )
}

/** A request's state, in the drawer's own vocabulary rather than a badge. */
function RequestStatus({ value }: { value: string }) {
  return (
    <span
      className={cn(
        'text-meta-sm',
        value === 'approved' ? 'text-ok' : value === 'declined' || value === 'rejected' ? 'text-destructive' : 'text-t4',
      )}
    >
      {value}
    </span>
  )
}
