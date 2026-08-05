import { api, apiOrigin, unwrap } from './api'
import type { ApiEnvelope, EntityId, TaskAttachment } from '../types/api'

/** Mirrors TaskAttachmentController::MAX_FILE_KB. */
export const MAX_ATTACHMENT_BYTES = 25600 * 1024
export const MAX_ATTACHMENTS_PER_UPLOAD = 10

const BLOCKED_EXTENSIONS = [
  'php', 'php3', 'php4', 'php5', 'php7', 'php8', 'phps', 'phtml', 'phar', 'htaccess', 'htpasswd',
  'exe', 'msi', 'com', 'bat', 'cmd', 'scr', 'cpl', 'jar', 'sh', 'bash', 'ps1', 'psm1', 'vbs', 'wsf',
]

export function attachmentName(attachment: TaskAttachment): string {
  return attachment.originalName ?? attachment.original_name ?? 'Attachment'
}

export function attachmentMime(attachment: TaskAttachment): string {
  return attachment.mimeType ?? attachment.mime_type ?? 'application/octet-stream'
}

export function attachmentSize(attachment: TaskAttachment): number {
  return attachment.fileSize ?? attachment.file_size ?? 0
}

export function attachmentCanPreview(attachment: TaskAttachment): boolean {
  return attachment.canPreview ?? attachment.can_preview ?? false
}

/** Cookie auth means a plain URL works for `img`/`video`/download links. */
export function attachmentUrl(taskId: EntityId, attachmentId: EntityId, inline = false): string {
  return `${apiOrigin}/api/tasks/${taskId}/attachments/${attachmentId}${inline ? '?inline=1' : ''}`
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 KB'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

export function fileKind(mime: string): 'image' | 'video' | 'audio' | 'pdf' | 'file' {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime === 'application/pdf') return 'pdf'
  return 'file'
}

export async function uploadTaskAttachments(taskId: EntityId, files: File[], adminOverride = false): Promise<TaskAttachment[]> {
  const form = new FormData()
  files.forEach((file) => form.append('files[]', file))
  if (adminOverride) form.append('admin_override', '1')
  const response = await api.post<ApiEnvelope<TaskAttachment[]> | TaskAttachment[]>(`/api/tasks/${taskId}/attachments`, form)

  return unwrap(response)
}

/** The same guard the API applies, so a doomed upload is caught before it flies. */
export function rejectionReason(file: File): string {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (BLOCKED_EXTENSIONS.includes(extension)) return `${file.name} is an executable or script file.`
  if (file.size > MAX_ATTACHMENT_BYTES) return `${file.name} is larger than ${formatBytes(MAX_ATTACHMENT_BYTES)}.`
  return ''
}
