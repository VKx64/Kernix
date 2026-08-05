import { useEffect, useState, type FormEvent } from 'react'
import { Check, Clock, File, FileImage, FileVideo, Flag, Music, Trash2, Upload } from 'lucide-react'
import { Avatar } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'
import { displayName } from '../lib/api'
import { MAX_ATTACHMENTS_PER_UPLOAD, MAX_ATTACHMENT_BYTES, fileKind, formatBytes, rejectionReason } from '../lib/attachments'
import { MIN_PROOF_SUMMARY, proofState } from '../lib/completionProof'
import type { CompletionProof as Proof } from '../types/api'

const KIND_ICONS: Record<ReturnType<typeof fileKind>, typeof File> = {
  image: FileImage,
  video: FileVideo,
  audio: Music,
  pdf: File,
  file: File,
}

export function CompletionProofModal({
  open,
  busy,
  error,
  taskTitle,
  onClose,
  onSubmit,
}: {
  open: boolean
  busy: boolean
  error?: string
  taskTitle: string
  onClose: () => void
  onSubmit: (summary: string, files: File[]) => void | Promise<void>
}) {
  const [summary, setSummary] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [validationError, setValidationError] = useState('')

  useEffect(() => {
    if (!open) return
    setSummary('')
    setFiles([])
    setValidationError('')
  }, [open])

  const addFiles = (incoming: FileList | null) => {
    if (!incoming?.length) return
    setValidationError('')
    const accepted: File[] = []
    for (const file of Array.from(incoming)) {
      const reason = rejectionReason(file)
      if (reason) {
        setValidationError(reason)
        continue
      }
      if (files.some((existing) => existing.name === file.name && existing.size === file.size)) continue
      accepted.push(file)
    }
    if (accepted.length) setFiles((current) => [...current, ...accepted].slice(0, MAX_ATTACHMENTS_PER_UPLOAD))
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = summary.trim()
    if (trimmed.length < MIN_PROOF_SUMMARY) {
      setValidationError('Describe what you completed in a little more detail.')
      return
    }
    if (!files.length) {
      setValidationError('Attach at least one file that shows the work is done.')
      return
    }
    void onSubmit(trimmed, files)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Submit proof of completion</DialogTitle>
          <DialogDescription>
            Show what you finished on “{taskTitle}”. An AI auditor checks it against the brief before the task closes.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="proof-summary">
              What did you complete? <span aria-hidden="true" className="text-destructive">*</span>
            </Label>
            <Textarea
              id="proof-summary"
              value={summary}
              disabled={busy}
              placeholder="Describe the finished work: what was delivered, where it lives, and anything the reviewer should check."
              onChange={(event) => { setSummary(event.target.value); setValidationError('') }}
            />
          </div>

          <div className="space-y-2">
            <Label>
              Evidence <span aria-hidden="true" className="text-destructive">*</span>
            </Label>
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center hover:bg-accent/40">
              <Upload className="size-5 text-muted-foreground" />
              <span className="space-y-0.5">
                <span className="block text-sm font-medium">Attach screenshots, exports, or photos</span>
                <span className="block text-xs text-muted-foreground">Up to {MAX_ATTACHMENTS_PER_UPLOAD} files, {formatBytes(MAX_ATTACHMENT_BYTES)} each.</span>
              </span>
              <input
                className="sr-only"
                type="file"
                multiple
                aria-label="Attach proof files"
                disabled={busy}
                onChange={(event) => { addFiles(event.target.files); event.target.value = '' }}
              />
            </label>
            {files.length > 0 && (
              <ul className="space-y-2">
                {files.map((file) => (
                  <li key={`${file.name}-${file.size}-${file.lastModified}`} className="flex items-center gap-2 rounded-md border p-2">
                    {(() => { const KindIcon = KIND_ICONS[fileKind(file.type)]; return <KindIcon className="size-4 text-muted-foreground" /> })()}
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-sm">{file.name}</strong>
                      <small className="block text-xs text-muted-foreground">{formatBytes(file.size)}</small>
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-destructive hover:text-destructive"
                      aria-label={`Remove ${file.name}`}
                      disabled={busy}
                      onClick={() => setFiles((current) => current.filter((candidate) => candidate !== file))}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {(validationError || error) && (
            <Alert variant="destructive">
              <AlertDescription>{validationError || error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit proof'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function CompletionProofCard({
  proof,
  canReview,
  busy,
  onSettle,
  onResubmit,
}: {
  proof: Proof
  canReview: boolean
  busy: boolean
  onSettle: (approved: boolean, reason: string) => void | Promise<void>
  onResubmit?: () => void
}) {
  const state = proofState(proof)!
  const [reason, setReason] = useState('')
  const [rejecting, setRejecting] = useState(false)

  const headline = state.status === 'approved'
    ? 'Completion proof accepted'
    : state.status === 'rejected'
      ? 'Completion proof not accepted'
      : state.awaitsHumanReview
        ? 'Waiting on a reviewer'
        : 'Audit in progress'
  const HeadlineIcon = state.status === 'approved' ? Check : state.status === 'rejected' ? Flag : Clock

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <header className="flex items-center gap-2">
        <HeadlineIcon className="size-4 text-muted-foreground" />
        <strong className="text-sm">{headline}</strong>
      </header>
      <p className="text-sm">{proof.summary}</p>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Avatar user={state.submitter} className="size-5" />
        {displayName(state.submitter)}
        {state.submittedAt ? ` · ${new Date(state.submittedAt).toLocaleDateString()}` : ''}
        {state.reviewMode ? ` · ${state.reviewMode === 'ai' ? 'AI audit' : 'Reviewed by a person'}` : ''}
      </p>

      {state.message && <p className="text-sm text-pretty">{state.message}</p>}
      {state.missing.length > 0 && (
        <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
          {state.missing.map((item) => <li key={item}>{item}</li>)}
        </ul>
      )}
      {state.reviewReason && <p className="text-sm text-pretty">{state.reviewReason}</p>}

      {state.status === 'rejected' && onResubmit && (
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onResubmit}>
          <Upload /> Submit new proof
        </Button>
      )}

      {canReview && state.status === 'pending' && (
        <div className="space-y-3">
          {rejecting && (
            <div className="space-y-2">
              <Label htmlFor="proof-reject-reason">Why is this not accepted?</Label>
              <Textarea id="proof-reject-reason" value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} placeholder="Tell the submitter what is missing…" />
            </div>
          )}
          <div className="flex justify-end gap-2">
            {rejecting ? (
              <>
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setRejecting(false); setReason('') }}>Cancel</Button>
                <Button type="button" variant="destructive" size="sm" disabled={busy || !reason.trim()} onClick={() => void onSettle(false, reason.trim())}>Confirm rejection</Button>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setRejecting(true)}>Reject</Button>
                <Button type="button" size="sm" disabled={busy} onClick={() => void onSettle(true, '')}>Approve completion</Button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
