import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { X } from 'lucide-react'
import { useWorkspace } from '@/auth/WorkspaceProvider'
import { ClockGate, isClockGate } from '@/components/ClockGate'
import { LabelRow } from '@/components/kernix/label-row'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { api, unwrap } from '@/lib/api'
import { mapLabel } from '@/lib/formFieldCatalogue'
import { cn } from '@/lib/utils'
import type { ApiEnvelope, FormSubmission, ProjectFormField } from '@/types/api'

/**
 * Screen D. Same shell as the task drawer — a right-side panel over the list
 * rather than a page swap — because leaving the queue to read one submission
 * should not cost your place in it.
 *
 * Answers render against `form_snapshot`, never the live form: editing the
 * form later must never change how an old submission reads. The "Will
 * become" block exists so the mapping is visible before Create task applies
 * it, which is the entire point of the review step.
 */
export function SubmissionDrawer({ submissionId, onClose, onDecided }: {
  submissionId: string | number
  onClose: () => void
  onDecided?: (submission: FormSubmission) => void
}) {
  const { canMutateTasks } = useWorkspace()
  const [submission, setSubmission] = useState<FormSubmission | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showClockGate, setShowClockGate] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    void api.get<ApiEnvelope<FormSubmission>>(`/api/form-submissions/${submissionId}`)
      .then((response) => { if (active) setSubmission(unwrap(response)) })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to load this submission.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [submissionId])

  const decline = async () => {
    if (!submission) return
    const reason = window.prompt('Reason for declining (optional):') ?? undefined
    setBusy(true); setError('')
    try {
      const response = await api.post<ApiEnvelope<FormSubmission>>(`/api/form-submissions/${submission.id}/decline`, reason ? { decline_reason: reason } : undefined)
      const updated = unwrap(response)
      setSubmission(updated)
      onDecided?.(updated)
    } catch (reason2) {
      setError(reason2 instanceof Error ? reason2.message : 'Unable to decline this submission.')
    } finally { setBusy(false) }
  }

  const convert = async (path: 'convert' | 'reconvert') => {
    if (!submission) return
    if (!canMutateTasks) { setShowClockGate(true); return }
    setBusy(true); setError(''); setShowClockGate(false)
    try {
      await api.post(`/api/form-submissions/${submission.id}/${path}`)
      const response = await api.get<ApiEnvelope<FormSubmission>>(`/api/form-submissions/${submission.id}`)
      const updated = unwrap(response)
      setSubmission(updated)
      onDecided?.(updated)
    } catch (reason) {
      if (isClockGate(reason)) { setShowClockGate(true) } else {
        setError(reason instanceof Error ? reason.message : 'Unable to create a task from this submission.')
      }
    } finally { setBusy(false) }
  }

  const snapshot = submission?.form_snapshot
  const fields = snapshot?.fields ?? []
  const answers = submission?.answers ?? {}
  const decided = submission ? submission.status !== 'new' : false
  const taskDeleted = submission?.status === 'converted' && !submission.task
  const from = submission?.submitter_name || submission?.email || 'Anonymous'

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Close submission" onClick={onClose} className="absolute inset-0 animate-in bg-[rgba(4,4,6,0.5)] fade-in duration-150" />
      <div role="dialog" aria-label={submission ? `Submission from ${from}` : 'Submission'} className="relative flex h-full w-[560px] max-w-full animate-in flex-col border-l border-line bg-[#0e0e10] duration-200 slide-in-from-right-8">
        <div className="flex flex-none items-center gap-2 py-3 pr-3.5 pl-5">
          <span className="flex-1 font-mono text-[11px] text-label-fg">{submission ? `#${submission.id}` : ''}</span>
          {submission?.possible_duplicate_of != null && <Badge variant="warning">Possible duplicate</Badge>}
          <Button variant="ghost" size="icon-sm" className="size-[27px]" onClick={onClose} aria-label="Close submission"><X className="size-[11px]" /></Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-[22px] overflow-y-auto px-6 pt-1 pb-8">
          {loading && !submission && (
            <div className="flex flex-col gap-4 pt-2">
              <Skeleton className="h-6 w-4/5" />
              <Skeleton className="h-3 w-2/5" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}
          {error && <p className="text-body-sm text-danger">{error}</p>}

          {submission && (
            <>
              <div className="flex flex-col gap-1.5">
                <h2 className="text-[19px] leading-[1.3] font-semibold tracking-[-0.02em] text-title-strong">{from}</h2>
                <span className="text-body-sm text-t3">
                  {submission.email && submission.submitter_name ? submission.email : ''}
                  {submission.email && submission.submitter_name ? ' · ' : ''}
                  {new Date(submission.created_at).toLocaleString()}
                </span>
              </div>

              <section className="flex flex-col gap-3">
                <LabelRow>Answers</LabelRow>
                <div className="flex flex-col gap-3">
                  {fields.map((field) => (
                    <AnswerRow key={field.id} field={field} value={answers[field.id]} />
                  ))}
                </div>
              </section>

              {(submission.files?.length ?? 0) > 0 && (
                <section className="flex flex-col gap-2">
                  <LabelRow>Files</LabelRow>
                  <div className="flex flex-col gap-1.5">
                    {submission.files?.map((file) => (
                      <a key={file.id} href={file.url ?? '#'} target="_blank" rel="noreferrer" className="truncate text-body-sm text-brand hover:text-brand-hover">
                        {file.filename ?? file.file_name ?? `File #${file.id}`}
                      </a>
                    ))}
                  </div>
                </section>
              )}

              <section className="flex flex-col gap-2 rounded-xl border border-line-soft bg-inset p-3.5">
                <LabelRow>Will become</LabelRow>
                <WillBecome fields={fields} answers={answers} />
              </section>

              {submission.status === 'declined' && (
                <p className="text-body-sm text-t3">Declined{submission.decline_reason ? `: ${submission.decline_reason}` : '.'}</p>
              )}
              {submission.status === 'converted' && submission.task && (
                <p className="text-body-sm text-t3">
                  Converted to <Link className="text-brand hover:text-brand-hover" to={`/tasks/${submission.task.id}`}>{submission.task.title}</Link>
                </p>
              )}
              {taskDeleted && <p className="text-body-sm text-warn">Task was deleted.</p>}

              {showClockGate && <ClockGate compact />}
            </>
          )}
        </div>

        {submission && (
          <div className="flex flex-none items-center gap-[7px] border-t border-line-soft px-5 py-3">
            {!decided && (
              <>
                <Button disabled={busy} onClick={() => void convert('convert')}>Create task</Button>
                <Button variant="outline" className="text-danger hover:text-danger" disabled={busy} onClick={() => void decline()}>Decline</Button>
              </>
            )}
            {taskDeleted && (
              <Button disabled={busy} onClick={() => void convert('reconvert')}>Create task again</Button>
            )}
            <span className="flex-1" />
            <span className="font-mono text-[10.5px] text-t4">Esc</span>
          </div>
        )}
      </div>
    </div>
  )
}

function AnswerRow({ field, value }: { field: ProjectFormField; value: unknown }) {
  return (
    <div className={cn('flex flex-col gap-1 rounded-lg border border-line-soft px-3 py-2.5', !!field.maps && field.maps !== 'none' && 'border-brand/40')}>
      <div className="flex items-center gap-2">
        <span className="text-meta-sm text-t3">{field.label}</span>
        {!!field.maps && field.maps !== 'none' && (
          <span className="font-mono text-[10px] text-t4">→ {mapLabel(field.maps)}</span>
        )}
      </div>
      <AnswerValue field={field} value={value} />
    </div>
  )
}

function AnswerValue({ field, value }: { field: ProjectFormField; value: unknown }) {
  if (value == null || value === '') return <span className="text-body-sm text-t4">Not answered</span>
  if (field.type === 'steps' && typeof value === 'string') {
    const steps = value.split('\n').map((line) => line.trim()).filter(Boolean)
    return (
      <ul className="list-disc pl-4 text-body-sm text-t1">
        {steps.map((step, index) => <li key={index}>{step}</li>)}
      </ul>
    )
  }
  if ((field.type === 'severity' || field.type === 'select') && field.choices) {
    const choice = field.choices.find((item) => item.value === value)
    return <span className="text-body-sm text-t1">{choice?.label ?? String(value)}</span>
  }
  return <span className="text-body-sm whitespace-pre-wrap text-t1">{String(value)}</span>
}

function WillBecome({ fields, answers }: { fields: ProjectFormField[]; answers: Record<string, unknown> }) {
  const targets: Array<{ key: string; label: string }> = [
    { key: 'title', label: 'Title' },
    { key: 'description', label: 'Description' },
    { key: 'subtasks', label: 'Subtasks' },
    { key: 'urgency', label: 'Urgency' },
    { key: 'due', label: 'Due date' },
  ]
  const rows = targets.map((target) => {
    const field = fields.find((item) => item.maps === target.key)
    if (!field) return null
    const raw = answers[field.id]
    let preview: string
    if (target.key === 'urgency' && field.choices) {
      preview = field.choices.find((choice) => choice.value === raw)?.label ?? '—'
    } else if (target.key === 'subtasks' && typeof raw === 'string') {
      preview = raw.split('\n').filter((line) => line.trim()).length + ' step(s)'
    } else {
      preview = raw ? String(raw) : '—'
    }
    return { ...target, preview }
  }).filter((row): row is { key: string; label: string; preview: string } => row !== null)

  if (!rows.length) return <p className="text-body-sm text-t4">No field on this form maps into the task yet.</p>

  return (
    <dl className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <div key={row.key} className="flex items-baseline justify-between gap-3">
          <dt className="text-meta text-t3">{row.label}</dt>
          <dd className="truncate text-body-sm text-t1">{row.preview}</dd>
        </div>
      ))}
    </dl>
  )
}
