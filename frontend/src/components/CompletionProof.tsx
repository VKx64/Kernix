import { useEffect, useState, type FormEvent } from 'react'
import { Icon, type IconName } from './Icon'
import { Modal } from './ui'
import { displayName } from '../lib/api'
import { MAX_ATTACHMENTS_PER_UPLOAD, MAX_ATTACHMENT_BYTES, fileKind, formatBytes, rejectionReason } from '../lib/attachments'
import { MIN_PROOF_SUMMARY, proofState } from '../lib/completionProof'
import type { CompletionProof as Proof } from '../types/api'

const KIND_ICONS: Record<ReturnType<typeof fileKind>, IconName> = {
  image: 'image',
  video: 'video',
  audio: 'play',
  pdf: 'file',
  file: 'file',
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
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={busy}
      title="Submit proof of completion"
      description={`Show what you finished on “${taskTitle}”. An AI auditor checks it against the brief before the task closes.`}
      size="md"
    >
      <form className="entity-form completion-proof-form" onSubmit={submit}>
        <label className="form-field wide">
          <span className="field-label">What did you complete? <b aria-hidden="true">*</b></span>
          <textarea
            value={summary}
            disabled={busy}
            placeholder="Describe the finished work: what was delivered, where it lives, and anything the reviewer should check."
            onChange={(event) => { setSummary(event.target.value); setValidationError('') }}
          />
        </label>

        <div className="form-field wide">
          <span className="field-label">Evidence <b aria-hidden="true">*</b></span>
          <label className="proof-dropzone">
            <Icon name="upload" size={18} />
            <span>
              <strong>Attach screenshots, exports, or photos</strong>
              <small>Up to {MAX_ATTACHMENTS_PER_UPLOAD} files, {formatBytes(MAX_ATTACHMENT_BYTES)} each.</small>
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
            <ul className="attachment-rows">
              {files.map((file) => (
                <li key={`${file.name}-${file.size}-${file.lastModified}`}>
                  <span className="attachment-kind"><Icon name={KIND_ICONS[fileKind(file.type)]} size={15} /></span>
                  <span className="attachment-meta"><strong>{file.name}</strong><small>{formatBytes(file.size)}</small></span>
                  <button
                    type="button"
                    className="icon-button danger"
                    aria-label={`Remove ${file.name}`}
                    disabled={busy}
                    onClick={() => setFiles((current) => current.filter((candidate) => candidate !== file))}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {(validationError || error) && <div className="form-error" role="alert">{validationError || error}</div>}

        <footer className="form-footer">
          <button type="button" className="btn btn-quiet" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit proof'}</button>
        </footer>
      </form>
    </Modal>
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

  const tone = state.status === 'approved' ? 'is-approved' : state.status === 'rejected' ? 'is-rejected' : 'is-pending'
  const headline = state.status === 'approved'
    ? 'Completion proof accepted'
    : state.status === 'rejected'
      ? 'Completion proof not accepted'
      : state.awaitsHumanReview
        ? 'Waiting on a reviewer'
        : 'Audit in progress'

  return (
    <section className={`proof-card ${tone}`}>
      <header>
        <Icon name={state.status === 'approved' ? 'check' : state.status === 'rejected' ? 'flag' : 'clock'} size={15} />
        <strong>{headline}</strong>
      </header>
      <p className="proof-summary">{proof.summary}</p>
      <small className="proof-byline">
        {displayName(state.submitter)}
        {state.submittedAt ? ` · ${new Date(state.submittedAt).toLocaleDateString()}` : ''}
        {state.reviewMode ? ` · ${state.reviewMode === 'ai' ? 'AI audit' : 'Reviewed by a person'}` : ''}
      </small>

      {state.message && <p className="proof-verdict">{state.message}</p>}
      {state.missing.length > 0 && (
        <ul className="proof-missing">
          {state.missing.map((item) => <li key={item}>{item}</li>)}
        </ul>
      )}
      {state.reviewReason && <p className="proof-verdict">{state.reviewReason}</p>}

      {state.status === 'rejected' && onResubmit && (
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={onResubmit}>
          <Icon name="upload" size={15} /> Submit new proof
        </button>
      )}

      {canReview && state.status === 'pending' && (
        <div className="proof-review">
          {rejecting && (
            <label className="form-field wide">
              <span className="field-label">Why is this not accepted?</span>
              <textarea value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} placeholder="Tell the submitter what is missing…" />
            </label>
          )}
          <div className="proof-review-actions">
            {rejecting ? (
              <>
                <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => { setRejecting(false); setReason('') }}>Cancel</button>
                <button type="button" className="btn btn-danger-quiet" disabled={busy || !reason.trim()} onClick={() => void onSettle(false, reason.trim())}>Confirm rejection</button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => setRejecting(true)}>Reject</button>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void onSettle(true, '')}>Approve completion</button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
