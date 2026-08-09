import { Check } from 'lucide-react'
import { Avatar, Minutes, StatusBadge } from '@/components/shared'
import { LabelRow } from '@/components/kernix/label-row'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { displayName } from '@/lib/api'
import type { EstimateRequest } from '@/types/api'
import { approvedMinutes, requestedMinutes } from './signals'

export type DecisionKind = 'review' | 'override'
export type DecisionMode = 'approve' | 'reject'

/**
 * The estimate decision, made in the thread where the ask was made rather than
 * in a modal on top of it. Whoever is deciding can still read the argument
 * above while they type the reason, which is what the reason is for.
 */
export function EstimateDecision({
  request,
  aiReview,
  aiStatusLine,
  kind,
  mode,
  minutes,
  reason,
  busy,
  loggedMinutes,
  estimateMinutes,
  onMode,
  onMinutes,
  onReason,
  onSubmit,
}: {
  request: EstimateRequest
  aiReview: boolean
  aiStatusLine: string
  /** Null when this seat can only read the decision. */
  kind: DecisionKind | null
  mode: DecisionMode | null
  minutes: number
  reason: string
  busy: boolean
  loggedMinutes: number
  estimateMinutes: number
  onMode: (mode: DecisionMode | null) => void
  onMinutes: (minutes: number) => void
  onReason: (reason: string) => void
  onSubmit: (mode: DecisionMode) => void
}) {
  const requested = requestedMinutes(request)

  return (
    <section className="mt-5 flex flex-col gap-3 rounded-xl border border-line-soft bg-inset px-[15px] pt-3.5 pb-3">
      <div className="flex items-baseline gap-2.5">
        <LabelRow>Estimate request</LabelRow>
        <span className="flex-1" />
        <StatusBadge value={request.status} />
      </div>

      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <Figure label="Requested" value={<Minutes value={requested} />} />
        <Figure label="Estimate then" value={<Minutes value={request.baseEstimatedMinutes ?? request.base_estimated_minutes ?? 0} />} />
        {request.status === 'approved' && <Figure label="Approved" value={<Minutes value={approvedMinutes(request)} />} />}
        {/* The time already spent is the other half of the judgement, so it
            travels with the request instead of living in a side rail. */}
        {estimateMinutes > 0 && (
          <Figure
            label="Logged"
            value={<><Minutes value={loggedMinutes} /> <span className="text-t3">of <Minutes value={estimateMinutes} /></span></>}
          />
        )}
      </div>

      {aiReview && (
        <p className="text-body-sm text-t3">
          <strong className="font-[550] text-t1">AI project manager:</strong> {aiStatusLine}
        </p>
      )}
      {request.status === 'replaced' && (
        <p className="text-body-sm text-t3">This request was replaced by a newer request.</p>
      )}

      {kind && !mode && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => { onMode('approve'); onMinutes(requested) }}>
            <Check /> {kind === 'override' ? 'Override as approved' : 'Approve'} <Minutes value={requested} />
          </Button>
          <Button variant="outline" onClick={() => onMode('reject')}>
            {kind === 'override' ? 'Override as rejected' : 'Reject'}
          </Button>
        </div>
      )}

      {kind && mode && (
        <div className="flex flex-col gap-3">
          {mode === 'approve' && (
            <div className="space-y-1.5">
              <Label htmlFor="decision-minutes">Approved additional minutes</Label>
              <Input
                id="decision-minutes"
                type="number"
                min="1"
                max={kind === 'override' ? requested : undefined}
                value={minutes}
                onChange={(event) => onMinutes(Number(event.target.value))}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="decision-reason">
              {kind === 'override' ? 'Reason for override' : `Why are you ${mode === 'approve' ? 'approving' : 'rejecting'} it?`}
            </Label>
            <Textarea
              id="decision-reason"
              value={reason}
              onChange={(event) => onReason(event.target.value)}
              placeholder="This is kept in the decision history…"
            />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { onMode(null); onReason('') }}>Cancel</Button>
            <Button
              disabled={busy || !reason.trim() || (mode === 'approve' && minutes < 1)}
              onClick={() => onSubmit(mode)}
            >
              {busy ? 'Saving…' : mode === 'approve' ? 'Approve & update estimate' : 'Reject request'}
            </Button>
          </div>
        </div>
      )}

      {request.decisions?.length ? (
        <details className="text-body-sm">
          <summary className="cursor-pointer text-t3">Decision history ({request.decisions.length})</summary>
          <div className="mt-2 flex flex-col gap-2">
            {request.decisions.map((decision) => (
              <div key={decision.id}>
                <strong className="inline-flex items-center gap-1.5 font-[550] text-t1">
                  {!['ai', 'human_override', 'system'].includes(decision.source ?? '') && <Avatar user={decision.decider} className="size-5" />}
                  {decision.source === 'ai'
                    ? 'AI project manager'
                    : decision.source === 'human_override'
                      ? 'Human override'
                      : decision.source === 'system'
                        ? 'System'
                        : displayName(decision.decider)}
                </strong>
                <span className="ml-1 text-t3">
                  {decision.action}
                  {decision.action === 'approve'
                    ? ` · ${decision.approvedAdditionalMinutes ?? decision.approved_additional_minutes ?? 0} minutes`
                    : ''}
                </span>
                <p className="text-t3">{decision.reason}</p>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  )
}

function Figure({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-meta-sm text-t4">{label}</span>
      <strong className="text-body-lg font-[550] text-t1">{value}</strong>
    </div>
  )
}
