import { useRef, useState, type DragEvent } from 'react'
import { Download, Eye, File, FileImage, FileVideo, Music, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { EmptyState } from '@/components/shared'
import { cn } from '@/lib/utils'
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

const KIND_ICONS: Record<ReturnType<typeof fileKind>, typeof File> = {
  image: FileImage,
  video: FileVideo,
  audio: Music,
  pdf: File,
  file: File,
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
    <section className="space-y-4">
      {canUpload && (
        <div
          className={cn(
            'flex flex-col items-center gap-3 rounded-lg border border-dashed p-6 text-center transition-colors',
            dragging && 'border-primary bg-accent/40',
          )}
          onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <Upload className="size-6 text-muted-foreground" />
          <div className="space-y-1">
            <p className="text-sm font-medium">Drop files here</p>
            <p className="text-xs text-muted-foreground">Pictures, video, and documents up to {formatBytes(MAX_ATTACHMENT_BYTES)} each.</p>
          </div>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? 'Uploading…' : 'Choose files'}
          </Button>
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

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!attachments.length ? (
        <EmptyState title="No files are attached to this task yet." icon={File} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {attachments.map((attachment) => {
            const name = attachmentName(attachment)
            const mime = attachmentMime(attachment)
            const kind = fileKind(mime)
            const previewable = attachmentCanPreview(attachment)
            const uploader = attachment.uploadedBy ?? attachment.uploaded_by
            const KindIcon = KIND_ICONS[kind]

            return (
              <li key={attachment.id} className="flex items-center gap-3 rounded-lg border p-3">
                <button
                  type="button"
                  className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted"
                  aria-label={previewable ? `Preview ${name}` : `Open ${name}`}
                  onClick={() => previewable ? setPreview(attachment) : window.open(attachmentUrl(taskId, attachment.id), '_blank', 'noopener')}
                >
                  {kind === 'image' && previewable
                    ? <img src={attachmentUrl(taskId, attachment.id, true)} alt={name} loading="lazy" className="size-full object-cover" />
                    : <KindIcon className="size-5 text-muted-foreground" />}
                </button>
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-sm" title={name}>{name}</strong>
                  <small className="block truncate text-xs text-muted-foreground">
                    {formatBytes(attachmentSize(attachment))}{uploader ? ` · ${displayName(uploader)}` : ''}
                  </small>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {previewable && (
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`View ${name}`} onClick={() => setPreview(attachment)}>
                      <Eye />
                    </Button>
                  )}
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Download ${name}`} asChild>
                    <a href={attachmentUrl(taskId, attachment.id)} download={name}>
                      <Download />
                    </a>
                  </Button>
                  {canUpload && (
                    <Button type="button" variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" aria-label={`Delete ${name}`} disabled={busy} onClick={() => void remove(attachment)}>
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <Dialog open={Boolean(preview)} onOpenChange={(open) => { if (!open) setPreview(null) }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{preview ? attachmentName(preview) : 'Attachment'}</DialogTitle>
          </DialogHeader>
          {preview && <AttachmentPreview taskId={taskId} attachment={preview} />}
        </DialogContent>
      </Dialog>
    </section>
  )
}

function AttachmentPreview({ taskId, attachment }: { taskId: EntityId; attachment: TaskAttachment }) {
  const name = attachmentName(attachment)
  const source = attachmentUrl(taskId, attachment.id, true)
  const kind = fileKind(attachmentMime(attachment))

  return (
    <div className="space-y-3">
      {kind === 'image' && <img src={source} alt={name} className="max-h-[70vh] w-full rounded-md object-contain" />}
      {kind === 'video' && <video src={source} controls playsInline preload="metadata" className="w-full rounded-md" />}
      {kind === 'audio' && <audio src={source} controls preload="metadata" className="w-full" />}
      {kind === 'pdf' && <iframe src={source} title={name} className="h-[70vh] w-full rounded-md border" />}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{formatBytes(attachmentSize(attachment))}</span>
        <Button variant="outline" size="sm" asChild>
          <a href={attachmentUrl(taskId, attachment.id)} download={name}>
            <Download /> Download
          </a>
        </Button>
      </div>
    </div>
  )
}
