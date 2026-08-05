import { useRef, useState, type DragEvent } from 'react'
import { Icon, type IconName } from './Icon'
import { Modal } from './ui'
import { api, displayName } from '../lib/api'
import {
  MAX_ATTACHMENTS_PER_UPLOAD,
  MAX_ATTACHMENT_BYTES,
  attachmentCanPreview,
  attachmentMime,
  attachmentName,
  attachmentSize,
  attachmentUrl,
  fileKind,
  formatBytes,
  rejectionReason,
  uploadTaskAttachments,
} from '../lib/attachments'
import type { EntityId, TaskAttachment } from '../types/api'

const KIND_ICONS: Record<ReturnType<typeof fileKind>, IconName> = {
  image: 'image',
  video: 'video',
  audio: 'play',
  pdf: 'file',
  file: 'file',
}

export function TaskAttachments({
  taskId,
  attachments,
  canManage,
  readOnly = false,
  adminOverride = false,
  onChanged,
}: {
  taskId: EntityId
  attachments: TaskAttachment[]
  canManage: boolean
  readOnly?: boolean
  adminOverride?: boolean
  onChanged: () => void | Promise<void>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<TaskAttachment | null>(null)
  const canUpload = canManage && !readOnly

  const upload = async (incoming: FileList | File[] | null) => {
    const files = Array.from(incoming ?? [])
    if (!files.length) return
    const rejected = files.map(rejectionReason).find(Boolean)
    if (rejected) {
      setError(rejected)
      return
    }
    if (files.length > MAX_ATTACHMENTS_PER_UPLOAD) {
      setError(`Up to ${MAX_ATTACHMENTS_PER_UPLOAD} files can be uploaded at once.`)
      return
    }
    setBusy(true)
    setError('')
    try {
      await uploadTaskAttachments(taskId, files, adminOverride)
      await onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The files could not be uploaded.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (attachment: TaskAttachment) => {
    const name = attachmentName(attachment)
    if (!window.confirm(`Delete “${name}”? This cannot be undone.`)) return
    setBusy(true)
    setError('')
    try {
      await api.delete(`/api/tasks/${taskId}/attachments/${attachment.id}`, adminOverride ? { admin_override: 1 } : undefined)
      if (preview?.id === attachment.id) setPreview(null)
      await onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'This file could not be deleted.')
    } finally {
      setBusy(false)
    }
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    if (canUpload && !busy) void upload(event.dataTransfer.files)
  }

  return (
    <section className="task-attachments">
      {canUpload && (
        <div
          className={`attachment-dropzone ${dragging ? 'is-dragging' : ''}`.trim()}
          onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <Icon name="upload" size={18} />
          <div>
            <strong>Drop files here</strong>
            <small>Pictures, video, and documents up to {formatBytes(MAX_ATTACHMENT_BYTES)} each.</small>
          </div>
          <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? 'Uploading…' : 'Choose files'}
          </button>
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            multiple
            aria-label="Upload attachments"
            disabled={busy}
            onChange={(event) => {
              void upload(event.target.files)
              event.target.value = ''
            }}
          />
        </div>
      )}

      {error && <div className="form-error" role="alert">{error}</div>}

      {!attachments.length ? (
        <p className="empty-hint">No files are attached to this task yet.</p>
      ) : (
        <ul className="attachment-grid">
          {attachments.map((attachment) => {
            const name = attachmentName(attachment)
            const mime = attachmentMime(attachment)
            const kind = fileKind(mime)
            const previewable = attachmentCanPreview(attachment)
            const uploader = attachment.uploadedBy ?? attachment.uploaded_by

            return (
              <li key={attachment.id} className="attachment-card">
                <button
                  type="button"
                  className="attachment-thumb"
                  aria-label={previewable ? `Preview ${name}` : `Open ${name}`}
                  onClick={() => previewable ? setPreview(attachment) : window.open(attachmentUrl(taskId, attachment.id), '_blank', 'noopener')}
                >
                  {kind === 'image' && previewable
                    ? <img src={attachmentUrl(taskId, attachment.id, true)} alt={name} loading="lazy" />
                    : <Icon name={KIND_ICONS[kind]} size={24} />}
                </button>
                <div className="attachment-meta">
                  <strong title={name}>{name}</strong>
                  <small>{formatBytes(attachmentSize(attachment))}{uploader ? ` · ${displayName(uploader)}` : ''}</small>
                </div>
                <div className="attachment-actions">
                  {previewable && (
                    <button type="button" className="icon-button" aria-label={`View ${name}`} onClick={() => setPreview(attachment)}>
                      <Icon name="eye" size={15} />
                    </button>
                  )}
                  <a className="icon-button" href={attachmentUrl(taskId, attachment.id)} download={name} aria-label={`Download ${name}`}>
                    <Icon name="download" size={15} />
                  </a>
                  {canUpload && (
                    <button type="button" className="icon-button danger" aria-label={`Delete ${name}`} disabled={busy} onClick={() => void remove(attachment)}>
                      <Icon name="trash" size={15} />
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <Modal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview ? attachmentName(preview) : 'Attachment'}
        size="lg"
        className="attachment-preview-modal"
      >
        {preview && <AttachmentPreview taskId={taskId} attachment={preview} />}
      </Modal>
    </section>
  )
}

function AttachmentPreview({ taskId, attachment }: { taskId: EntityId; attachment: TaskAttachment }) {
  const name = attachmentName(attachment)
  const source = attachmentUrl(taskId, attachment.id, true)
  const kind = fileKind(attachmentMime(attachment))

  return (
    <div className="attachment-preview">
      {kind === 'image' && <img src={source} alt={name} />}
      {kind === 'video' && <video src={source} controls playsInline preload="metadata" />}
      {kind === 'audio' && <audio src={source} controls preload="metadata" />}
      {kind === 'pdf' && <iframe src={source} title={name} />}
      <footer>
        <span>{formatBytes(attachmentSize(attachment))}</span>
        <a className="btn btn-quiet" href={attachmentUrl(taskId, attachment.id)} download={name}>
          <Icon name="download" size={15} /> Download
        </a>
      </footer>
    </div>
  )
}
