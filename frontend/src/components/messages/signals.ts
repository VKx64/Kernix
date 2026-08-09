import type { Attachment, EntityId, EstimateRequest, Message, Note, UserSummary } from '@/types/api'

/**
 * The readers the Messages screen shares between its page and its parts.
 *
 * The API returns camel and snake spellings depending on the endpoint, so these
 * are the only place that has to know about both.
 */

export function noteTime(note?: Note | null) {
  const date = note?.createdAt ?? note?.created_at
  return date ? new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
}

/** Short, glanceable age for the list: "now", "22m", "4h", "Tue", "3 Mar". */
export function shortAge(note?: Note | null) {
  const date = note?.createdAt ?? note?.created_at
  if (!date) return ''
  const parsed = new Date(date)
  const minutes = Math.floor((Date.now() - parsed.getTime()) / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`
  if (minutes < 60 * 24 * 7) return parsed.toLocaleDateString([], { weekday: 'short' })
  return parsed.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

/** Separator label above the first message of each day in the thread. */
export function dayLabel(note?: Note | null) {
  const date = note?.createdAt ?? note?.created_at
  if (!date) return ''
  const parsed = new Date(date)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (parsed.toDateString() === today.toDateString()) return 'Today'
  if (parsed.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return parsed.toLocaleDateString([], {
    day: 'numeric',
    month: 'long',
    year: parsed.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  })
}

/** The person on the other side of the conversation, from the signed-in user's seat. */
export function counterpart(conversation: Message, userId?: EntityId): UserSummary | undefined {
  const participants = (conversation.messages ?? [conversation]).flatMap((message) => [
    message.author,
    message.assignedUser ?? message.assigned_user ?? undefined,
  ])
  return participants.find((person): person is UserSummary => Boolean(person) && String(person?.id) !== String(userId))
    ?? conversation.sender
    ?? conversation.author
}

export function authorId(note?: Note | null) {
  return String(note?.author?.id ?? note?.createdBy ?? note?.created_by ?? '')
}

export function unreadCount(message: Message) {
  return Number(message.unreadCount ?? message.unread_count ?? 0)
}

export function isUnread(message: Message) {
  return unreadCount(message) > 0
}

export function estimateRequest(message: Message) {
  return message.estimateRequest ?? message.estimate_request ?? null
}

export function requestedMinutes(request: EstimateRequest) {
  return Number(request.requestedAdditionalMinutes ?? request.requested_additional_minutes ?? 0)
}

export function approvedMinutes(request: EstimateRequest) {
  return Number(request.approvedAdditionalMinutes ?? request.approved_additional_minutes ?? requestedMinutes(request))
}

export function reviewMode(request: EstimateRequest) {
  return request.reviewMode ?? request.review_mode ?? 'human'
}

export function aiState(request: EstimateRequest) {
  return request.aiState ?? request.ai_state ?? null
}

export function attachmentName(file: Attachment) {
  return file.originalName ?? file.original_name ?? file.name ?? 'Attachment'
}

export function isOverdue(task?: Message['task']) {
  const due = task?.due_date
  if (!due) return false
  const statusKey = task?.status_value?.key ?? ''
  if (['complete', 'completed', 'cancelled'].includes(statusKey)) return false
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  return new Date(due).getTime() < midnight.getTime()
}
