import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { ChevronLeft, ChevronRight, Download, Eye, FileText, MoreVertical, Plus, Trash2, Upload, X } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { LabelRow } from '@/components/kernix/label-row'
import { api, displayName } from '@/lib/api'
import {
  MAX_ATTACHMENTS_PER_UPLOAD,
  attachmentCanPreview,
  attachmentMime,
  attachmentName,
  attachmentSize,
  attachmentUrl,
  fileKind,
  formatBytes,
  relativeTime,
  rejectionReason,
  uploadTaskAttachments,
} from '@/lib/attachments'
import { cn } from '@/lib/utils'
import type { EntityId, TaskAttachment } from '@/types/api'

/**
 * The drawer's FILES section: "images get shown, files get named". Anything
 * with a frame worth seeing becomes a cropped tile in a three-up grid;
 * everything else becomes the same file row the project and client panels
 * already use. Actions live in hover so the section, at rest, is only content.
 *
 * This is deliberately its own component rather than a reuse of
 * `TaskAttachments` — that one is the full task page's always-visible upload
 * panel, and stays that way.
 */

interface PendingUpload {
  key: string
  file: File
  status: 'uploading' | 'error'
}

/** A tile only renders what it can safely inline — same rule TaskAttachments uses. */
function isVisual(attachment: TaskAttachment): boolean {
  const kind = fileKind(attachmentMime(attachment))
  return (kind === 'image' || kind === 'video') && attachmentCanPreview(attachment)
}

function isVisualFile(file: File): boolean {
  return file.type.startsWith('image/') || file.type.startsWith('video/')
}

type VisualEntry =
  | { type: 'attachment'; attachment: TaskAttachment }
  | { type: 'pending'; pending: PendingUpload }

function entryKey(entry: VisualEntry): string {
  return entry.type === 'attachment' ? `attachment-${entry.attachment.id}` : `pending-${entry.pending.key}`
}

export function TaskDrawerFiles({
  taskId,
  attachments,
  canManage,
  adminOverride = false,
  onChanged,
  dragContainerRef,
}: {
  taskId: EntityId
  attachments: TaskAttachment[]
  canManage: boolean
  adminOverride?: boolean
  onChanged: () => void | Promise<void>
  /** The drawer's own root, so a file dragged anywhere over it targets this task. */
  dragContainerRef?: RefObject<HTMLElement | null>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<PendingUpload[]>([])
  const [error, setError] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [busyId, setBusyId] = useState<EntityId | null>(null)
  const [lightboxId, setLightboxId] = useState<EntityId | null>(null)
  const dragDepth = useRef(0)

  const upload = useCallback(async (files: File[]) => {
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
    setError('')
    const items: PendingUpload[] = files.map((file) => ({
      key: `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name}`,
      file,
      status: 'uploading',
    }))
    // Newest first, matching how the list comes back from the API — so a
    // finished upload lands in the same cell its placeholder held.
    setPending((current) => [...items, ...current])
    try {
      await uploadTaskAttachments(taskId, files, adminOverride)
      setPending((current) => current.filter((item) => !items.some((added) => added.key === item.key)))
      await onChanged()
    } catch (reason) {
      setPending((current) => current.map((item) => (items.some((added) => added.key === item.key) ? { ...item, status: 'error' } : item)))
      setError(reason instanceof Error ? reason.message : 'These files could not be uploaded.')
    }
  }, [taskId, adminOverride, onChanged])

  const retry = (item: PendingUpload) => {
    setPending((current) => current.filter((entry) => entry.key !== item.key))
    void upload([item.file])
  }

  const remove = async (attachment: TaskAttachment) => {
    const name = attachmentName(attachment)
    if (!window.confirm(`Delete “${name}”? This cannot be undone.`)) return
    setBusyId(attachment.id)
    setError('')
    try {
      await api.delete(`/api/tasks/${taskId}/attachments/${attachment.id}`, adminOverride ? { admin_override: 1 } : undefined)
      if (lightboxId === attachment.id) setLightboxId(null)
      await onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'This file could not be deleted.')
    } finally {
      setBusyId(null)
    }
  }

  const openTile = (attachment: TaskAttachment) => {
    if (fileKind(attachmentMime(attachment)) === 'image') {
      setLightboxId(attachment.id)
    } else {
      window.open(attachmentUrl(taskId, attachment.id), '_blank', 'noopener')
    }
  }

  // A file dropped anywhere over the drawer targets this task, not just the
  // grid — so the listeners sit on the drawer's own root rather than a local
  // dropzone element.
  useEffect(() => {
    const container = dragContainerRef?.current
    if (!container || !canManage) return

    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files')

    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      dragDepth.current += 1
      setDragActive(true)
    }
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
    }
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragActive(false)
    }
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      dragDepth.current = 0
      setDragActive(false)
      void upload(Array.from(event.dataTransfer?.files ?? []))
    }

    container.addEventListener('dragenter', onDragEnter as EventListener)
    container.addEventListener('dragover', onDragOver as EventListener)
    container.addEventListener('dragleave', onDragLeave as EventListener)
    container.addEventListener('drop', onDrop as EventListener)
    return () => {
      container.removeEventListener('dragenter', onDragEnter as EventListener)
      container.removeEventListener('dragover', onDragOver as EventListener)
      container.removeEventListener('dragleave', onDragLeave as EventListener)
      container.removeEventListener('drop', onDrop as EventListener)
    }
  }, [dragContainerRef, canManage, upload])

  const visualAttachments = attachments.filter(isVisual)
  const documentAttachments = attachments.filter((attachment) => !isVisual(attachment))
  const visualPending = pending.filter((item) => isVisualFile(item.file))
  const documentPending = pending.filter((item) => !isVisualFile(item.file))

  const visualEntries: VisualEntry[] = [
    ...visualPending.map((item): VisualEntry => ({ type: 'pending', pending: item })),
    ...visualAttachments.map((attachment): VisualEntry => ({ type: 'attachment', attachment })),
  ]

  const lightboxItems = useMemo(
    () => attachments.filter((attachment) => isVisual(attachment) && fileKind(attachmentMime(attachment)) === 'image'),
    [attachments],
  )
  const lightboxIndex = lightboxId == null ? -1 : lightboxItems.findIndex((attachment) => attachment.id === lightboxId)

  const isEmpty = attachments.length === 0 && pending.length === 0
  if (!canManage && attachments.length === 0) return null

  const showCounter = visualEntries.length > 6
  const displayedVisual = showCounter ? visualEntries.slice(0, 5) : visualEntries
  const hiddenCount = showCounter ? visualEntries.length - 5 : 0
  const isLone = visualEntries.length === 1 && visualEntries[0].type === 'attachment'

  const openHidden = () => {
    const firstHidden = visualEntries[5]
    if (firstHidden?.type === 'attachment' && fileKind(attachmentMime(firstHidden.attachment)) === 'image') {
      setLightboxId(firstHidden.attachment.id)
      return
    }
    if (lightboxItems.length > 0) setLightboxId(lightboxItems[0].id)
  }

  return (
    <section className="flex flex-col gap-[9px]">
      <div className="flex items-center gap-2.5">
        <LabelRow>Files</LabelRow>
        <span className="font-mono text-[11px] text-label-fg">{attachments.length}</span>
        <span className="flex-1" />
        {canManage && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex h-6 flex-none items-center gap-1 rounded-[7px] px-2 text-[11.5px] whitespace-nowrap text-t3 hover:bg-soft hover:text-t1"
          >
            <Plus className="size-3" />
            Add
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          aria-label="Upload files"
          disabled={!canManage}
          onChange={(event) => {
            void upload(Array.from(event.target.files ?? []))
            event.target.value = ''
          }}
        />
      </div>

      {error && <p className="text-[11px] text-destructive">{error}</p>}

      <div className="relative">
        <div className={cn('flex flex-col gap-2', dragActive && 'opacity-50')}>
          {visualEntries.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {isLone ? (
                <>
                  <VisualTile taskId={taskId} entry={visualEntries[0]} showCaption={false} onOpen={openTile} onRetry={retry} />
                  <MetaCell attachment={(visualEntries[0] as { type: 'attachment'; attachment: TaskAttachment }).attachment} />
                </>
              ) : (
                <>
                  {displayedVisual.map((entry) => (
                    <VisualTile key={entryKey(entry)} taskId={taskId} entry={entry} showCaption onOpen={openTile} onRetry={retry} />
                  ))}
                  {showCounter && <CounterTile count={hiddenCount} onOpen={openHidden} />}
                </>
              )}
            </div>
          )}

          {(documentAttachments.length > 0 || documentPending.length > 0) && (
            <div className="-mx-2 flex flex-col gap-px">
              {documentPending.map((item) => (
                <PendingDocRow key={item.key} pending={item} onRetry={retry} />
              ))}
              {documentAttachments.map((attachment) => (
                <FileRow
                  key={attachment.id}
                  taskId={taskId}
                  attachment={attachment}
                  canManage={canManage}
                  busy={busyId === attachment.id}
                  onDelete={remove}
                />
              ))}
            </div>
          )}

          {isEmpty && (
            canManage ? (
              <div className="flex items-center gap-2.5 rounded-[10px] border border-dashed border-line px-3 py-[13px]">
                <span className="grid size-6 flex-none place-items-center rounded-[7px] bg-soft">
                  <Upload className="size-3.5 text-t3" />
                </span>
                <p className="text-body-sm text-t3">
                  Drop files or{' '}
                  <button type="button" onClick={() => inputRef.current?.click()} className="text-brand hover:text-brand-hover hover:underline">
                    browse
                  </button>
                </p>
              </div>
            ) : (
              <p className="text-body-sm text-t4">No files yet.</p>
            )
          )}
        </div>

        {dragActive && (
          <div
            className="pointer-events-none absolute -inset-1.5 z-10 grid place-items-center rounded-[11px] border-[1.5px] border-dashed border-brand bg-brand/10 text-body-sm font-medium text-brand"
            aria-hidden="true"
          >
            Drop to attach
          </div>
        )}
      </div>

      {lightboxIndex >= 0 && (
        <Lightbox
          taskId={taskId}
          items={lightboxItems}
          index={lightboxIndex}
          onNavigate={(index) => setLightboxId(lightboxItems[index]?.id ?? null)}
          onClose={() => setLightboxId(null)}
        />
      )}
    </section>
  )
}

function VisualTile({
  taskId,
  entry,
  showCaption,
  onOpen,
  onRetry,
}: {
  taskId: EntityId
  entry: VisualEntry
  showCaption: boolean
  onOpen: (attachment: TaskAttachment) => void
  onRetry: (pending: PendingUpload) => void
}) {
  if (entry.type === 'pending') {
    const { pending } = entry
    if (pending.status === 'error') {
      return (
        <div className="relative flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-[9px] border border-destructive bg-destructive/10 p-2 text-center">
          <span className="text-[11.5px] text-destructive">Upload failed</span>
          <button
            type="button"
            onClick={() => onRetry(pending)}
            className="h-[22px] flex-none rounded-[6px] bg-soft px-[9px] text-meta-sm text-t1 hover:bg-elev"
          >
            Retry
          </button>
        </div>
      )
    }

    return (
      <div className="relative aspect-[4/3] overflow-hidden rounded-[9px] border border-line" aria-label={`Uploading ${pending.file.name}`}>
        <div className="absolute inset-0 grid place-items-center">
          <span className="size-6 animate-spin rounded-full border-2 border-line-strong border-t-brand" aria-hidden="true" />
        </div>
        <span className="absolute inset-x-0 bottom-0 h-[3px] animate-pulse bg-brand" aria-hidden="true" />
      </div>
    )
  }

  const { attachment } = entry
  const name = attachmentName(attachment)
  const kind = fileKind(attachmentMime(attachment))
  const source = attachmentUrl(taskId, attachment.id, true)

  return (
    <div className="group/tile relative aspect-[4/3] overflow-hidden rounded-[9px] border border-line">
      <button type="button" className="block size-full" aria-label={`Open ${name}`} onClick={() => onOpen(attachment)}>
        {kind === 'video' ? (
          <video src={source} muted playsInline preload="metadata" className="size-full object-cover" />
        ) : (
          <img src={source} alt={name} loading="lazy" className="size-full object-cover" />
        )}
      </button>

      {showCaption && (
        <span
          className="pointer-events-none absolute inset-x-0 bottom-0 truncate px-2 pt-[15px] pb-1.5 text-[11px] text-t1"
          style={{ background: 'linear-gradient(rgba(6,6,8,0), rgba(6,6,8,.94))' }}
        >
          {name}
        </span>
      )}

      <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 transition-opacity group-hover/tile:opacity-100 group-focus-within/tile:opacity-100">
        <button
          type="button"
          aria-label={`Preview ${name}`}
          onClick={() => onOpen(attachment)}
          className="grid size-6 place-items-center rounded-[6px] text-t1"
          style={{ background: 'rgba(10,10,12,.84)' }}
        >
          <Eye className="size-3.5" />
        </button>
        <a
          href={attachmentUrl(taskId, attachment.id)}
          download={name}
          aria-label={`Download ${name}`}
          className="grid size-6 place-items-center rounded-[6px] text-t1"
          style={{ background: 'rgba(10,10,12,.84)' }}
        >
          <Download className="size-3.5" />
        </a>
      </div>
    </div>
  )
}

/**
 * The neighbour a lone tile hands its metadata to, so a single-file row still
 * reads as finished rather than half-empty.
 */
function MetaCell({ attachment }: { attachment: TaskAttachment }) {
  const name = attachmentName(attachment)
  const uploader = attachment.uploadedBy ?? attachment.uploaded_by
  return (
    <div className="flex flex-col justify-center gap-1 px-1">
      <span className="truncate text-[12.5px] text-t1">{name}</span>
      <span className="truncate text-[11px] text-t3">
        {[formatBytes(attachmentSize(attachment)), uploader && displayName(uploader)].filter(Boolean).join(' · ')}
      </span>
      <span className="truncate text-[11px] text-t3">{relativeTime(attachment.createdAt ?? attachment.created_at)}</span>
    </div>
  )
}

function CounterTile({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`View ${count} more file${count === 1 ? '' : 's'}`}
      className="grid aspect-[4/3] place-items-center rounded-[9px] border border-line bg-soft text-[13px] font-semibold text-t1 hover:bg-elev"
    >
      +{count}
    </button>
  )
}

function FileRow({
  taskId,
  attachment,
  canManage,
  busy,
  onDelete,
}: {
  taskId: EntityId
  attachment: TaskAttachment
  canManage: boolean
  busy: boolean
  onDelete: (attachment: TaskAttachment) => void
}) {
  const name = attachmentName(attachment)
  const uploader = attachment.uploadedBy ?? attachment.uploaded_by
  const meta = [formatBytes(attachmentSize(attachment)), uploader && displayName(uploader), relativeTime(attachment.createdAt ?? attachment.created_at)]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="group/row flex items-center gap-2.5 rounded-[7px] px-2 py-[5px] hover:bg-soft">
      <FileText className="size-3.5 flex-none text-t3" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] text-t1">{name}</p>
        <p className="truncate text-[11px] text-t3">{meta}</p>
      </div>
      <div className="flex flex-none items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100">
        <a
          href={attachmentUrl(taskId, attachment.id)}
          download={name}
          aria-label={`Download ${name}`}
          className="grid size-6 place-items-center rounded-[6px] text-t3 hover:bg-elev hover:text-t1"
        >
          <Download className="size-3.5" />
        </a>
        {canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`More actions for ${name}`}
                className="grid size-6 place-items-center rounded-[6px] text-t3 hover:bg-elev hover:text-t1"
              >
                <MoreVertical className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[140px]">
              <DropdownMenuItem variant="destructive" disabled={busy} onSelect={() => onDelete(attachment)}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}

function PendingDocRow({ pending, onRetry }: { pending: PendingUpload; onRetry: (pending: PendingUpload) => void }) {
  if (pending.status === 'error') {
    return (
      <div className="flex items-center gap-2.5 rounded-[7px] border border-destructive bg-destructive/10 px-2 py-[5px]">
        <FileText className="size-3.5 flex-none text-destructive" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] text-t1">{pending.file.name}</p>
          <p className="text-[11px] text-destructive">Upload failed</p>
        </div>
        <button
          type="button"
          onClick={() => onRetry(pending)}
          className="h-[22px] flex-none rounded-[6px] bg-soft px-[9px] text-meta-sm text-t1 hover:bg-elev"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2.5 rounded-[7px] px-2 py-[5px]">
      <span className="size-3.5 flex-none animate-spin rounded-full border-2 border-line-strong border-t-brand" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] text-t1">{pending.file.name}</p>
        <p className="text-[11px] text-t3">Uploading…</p>
      </div>
    </div>
  )
}

/**
 * Clicking a tile opens the image, not a download. Arrows step through the
 * visual files only. Esc closes this before the drawer — the keydown listener
 * runs on the capture phase so it reaches window before the drawer's own
 * bubble-phase Escape handler does.
 */
function Lightbox({
  taskId,
  items,
  index,
  onNavigate,
  onClose,
}: {
  taskId: EntityId
  items: TaskAttachment[]
  index: number
  onNavigate: (index: number) => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key === 'ArrowLeft') {
        event.stopPropagation()
        onNavigate(Math.max(0, index - 1))
        return
      }
      if (event.key === 'ArrowRight') {
        event.stopPropagation()
        onNavigate(Math.min(items.length - 1, index + 1))
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [index, items.length, onNavigate, onClose])

  const attachment = items[index]
  if (!attachment) return null

  const name = attachmentName(attachment)
  const uploader = attachment.uploadedBy ?? attachment.uploaded_by
  const meta = [formatBytes(attachmentSize(attachment)), uploader && displayName(uploader), relativeTime(attachment.createdAt ?? attachment.created_at)]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      role="dialog"
      aria-label={name}
      className="fixed inset-0 z-[70] flex flex-col"
      style={{ background: 'rgba(4,4,6,.88)' }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="flex flex-none items-center justify-end gap-2 p-3">
        <a
          href={attachmentUrl(taskId, attachment.id)}
          download={name}
          aria-label={`Download ${name}`}
          className="grid size-[30px] place-items-center rounded-[8px] text-t1 hover:bg-white/10"
        >
          <Download className="size-4" />
        </a>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close viewer"
          className="grid size-[30px] place-items-center rounded-[8px] text-t1 hover:bg-white/10"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4">
        {index > 0 && (
          <button
            type="button"
            onClick={() => onNavigate(index - 1)}
            aria-label="Previous file"
            className="absolute left-3 grid size-[34px] place-items-center rounded-full text-t1 hover:bg-white/10"
            style={{ background: 'rgba(10,10,12,.84)' }}
          >
            <ChevronLeft className="size-4" />
          </button>
        )}
        <img src={attachmentUrl(taskId, attachment.id, true)} alt={name} className="max-h-full max-w-full rounded-[6px] object-contain" />
        {index < items.length - 1 && (
          <button
            type="button"
            onClick={() => onNavigate(index + 1)}
            aria-label="Next file"
            className="absolute right-3 grid size-[34px] place-items-center rounded-full text-t1 hover:bg-white/10"
            style={{ background: 'rgba(10,10,12,.84)' }}
          >
            <ChevronRight className="size-4" />
          </button>
        )}
      </div>

      <div className="flex flex-none items-end justify-between p-4">
        <div className="flex flex-col gap-1">
          <span className="text-[13px] text-t1">{name}</span>
          <span className="text-[11.5px] text-t3">{meta}</span>
        </div>
        <span className="font-mono text-[11px] text-t3">{index + 1} / {items.length}</span>
      </div>
    </div>
  )
}
