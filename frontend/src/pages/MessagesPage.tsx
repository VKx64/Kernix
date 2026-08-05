import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { Avatar, EmptyState, ErrorBanner, Minutes, Modal, StatusBadge } from '../components/ui'
import { Select } from '../components/fields'
import { Icon } from '../components/Icon'
import { OliverChat } from '../components/OliverChat'
import { api, displayName, normalizePage, unwrap } from '../lib/api'
import { useCollection } from '../lib/useCollection'
import { useCan } from '../lib/permissions'
import type { ApiEnvelope, Attachment, EntityId, EstimateRequest, Message, Note, Paginated, Task, UserSummary } from '../types/api'

function noteTime(note?: Note | null) {
  const date = note?.createdAt ?? note?.created_at
  return date ? new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
}

/** Short, glanceable age for the list: "now", "22m", "4h", "Tue", "3 Mar". */
function shortAge(note?: Note | null) {
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
function dayLabel(note?: Note | null) {
  const date = note?.createdAt ?? note?.created_at
  if (!date) return ''
  const parsed = new Date(date)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (parsed.toDateString() === today.toDateString()) return 'Today'
  if (parsed.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return parsed.toLocaleDateString([], { day: 'numeric', month: 'long', year: parsed.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

/** The person on the other side of the conversation, from the signed-in user's seat. */
function counterpart(conversation: Message, userId?: EntityId): UserSummary | undefined {
  const participants = (conversation.messages ?? [conversation]).flatMap((message) => [
    message.author,
    message.assignedUser ?? message.assigned_user ?? undefined,
  ])
  return participants.find((person): person is UserSummary => Boolean(person) && String(person?.id) !== String(userId))
    ?? conversation.sender
    ?? conversation.author
}

function isUnread(message: Message) {
  return Number(message.unreadCount ?? message.unread_count ?? 0) > 0
}

function estimateRequest(message: Message) {
  return message.estimateRequest ?? message.estimate_request ?? null
}

function requestedMinutes(request: EstimateRequest) {
  return Number(request.requestedAdditionalMinutes ?? request.requested_additional_minutes ?? 0)
}

function approvedMinutes(request: EstimateRequest) {
  return Number(request.approvedAdditionalMinutes ?? request.approved_additional_minutes ?? requestedMinutes(request))
}

function reviewMode(request: EstimateRequest) {
  return request.reviewMode ?? request.review_mode ?? 'human'
}

function aiState(request: EstimateRequest) {
  return request.aiState ?? request.ai_state ?? null
}

function attachmentName(file: Attachment) {
  return file.originalName ?? file.original_name ?? file.name ?? 'Attachment'
}

function isOverdue(task?: Message['task']) {
  const due = task?.due_date
  if (!due) return false
  const statusKey = task?.status_value?.key ?? ''
  if (['complete', 'completed', 'cancelled'].includes(statusKey)) return false
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  return new Date(due).getTime() < midnight.getTime()
}

type ViewKey = 'needs-reply' | 'estimates' | 'all' | 'estimate-requests' | 'overdue' | 'assigned-to-me'

const INBOX_VIEWS: Array<{ key: ViewKey; label: string }> = [
  { key: 'needs-reply', label: 'Needs reply' },
  { key: 'estimates', label: 'Estimates' },
  { key: 'all', label: 'All' },
]

const SMART_VIEWS: Array<{ key: ViewKey; label: string; tone?: 'warning' | 'danger' }> = [
  { key: 'estimate-requests', label: 'Estimate requests', tone: 'warning' },
  { key: 'overdue', label: 'Overdue tasks', tone: 'danger' },
  { key: 'assigned-to-me', label: 'Assigned to me' },
]

const SHORTCUTS: Array<[string, string]> = [
  ['J / K', 'Move'],
  ['R', 'Reply'],
  ['X', 'Select'],
  ['Enter', 'Open'],
]

function NewMessageModal({ open, onClose, onStarted }: { open: boolean; onClose: () => void; onStarted: (conversation: Message) => void }) {
  const [recipients, setRecipients] = useState<UserSummary[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [taskSearch, setTaskSearch] = useState('')
  const [recipientId, setRecipientId] = useState('')
  const [taskId, setTaskId] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setRecipientId(''); setTaskId(''); setBody(''); setError(''); setTaskSearch('')
    void (async () => {
      try {
        setRecipients(unwrap(await api.get<ApiEnvelope<UserSummary[]> | UserSummary[]>('/api/messages/recipients')) ?? [])
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Unable to load people.')
      }
    })()
  }, [open])

  // Task list is searchable because a workspace can hold far more tasks than a dropdown should show.
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const response = await api.get<Paginated<Task> | ApiEnvelope<Paginated<Task>> | Task[]>('/api/tasks', { per_page: 50, search: taskSearch || undefined }, controller.signal)
        setTasks(normalizePage(response).data)
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        setError(reason instanceof Error ? reason.message : 'Unable to load tasks.')
      }
    }, taskSearch ? 250 : 0)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [open, taskSearch])

  const send = async () => {
    if (!recipientId || !taskId || !body.trim()) return
    setBusy(true); setError('')
    try {
      const response = await api.post<ApiEnvelope<Message> | Message>('/api/messages', { recipient_id: Number(recipientId), task_id: Number(taskId), body: body.trim() })
      onStarted(unwrap(response))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to start this conversation.')
    } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="New conversation" description="Conversations are attached to a task so both of you share the same context." size="md">
      <div className="new-message-form">
        <Select label="Send to" value={recipientId} placeholder="Choose a person…" icon="profile" options={recipients.map((person) => ({ value: String(person.id), label: displayName(person) }))} onChange={setRecipientId} />
        <label className="message-search"><Icon name="search" size={16} /><input value={taskSearch} onChange={(event) => setTaskSearch(event.target.value)} placeholder="Search tasks…" /></label>
        <Select label="About task" value={taskId} placeholder={tasks.length ? 'Choose a task…' : 'No tasks match'} icon="task" options={tasks.map((task) => ({ value: String(task.id), label: task.project?.name ? `${task.title} · ${task.project.name}` : task.title }))} onChange={setTaskId} />
        <label className="field-label" htmlFor="new-message-body">Message</label>
        <textarea id="new-message-body" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write your message…" rows={5} />
        {error && <div className="form-error" role="alert">{error}</div>}
        <footer className="form-footer">
          <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy || !recipientId || !taskId || !body.trim()} onClick={() => void send()}><Icon name="send" size={15} /> {busy ? 'Sending…' : 'Send message'}</button>
        </footer>
      </div>
    </Modal>
  )
}

export function MessagesPage() {
  const can = useCan()
  const { user } = useAuth()
  const { messageId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const oliverOpen = messageId === 'oliver'
  const view = (searchParams.get('view') as ViewKey | null) ?? 'needs-reply'
  const [search, setSearch] = useState(searchParams.get('search') ?? '')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Message | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [replyBody, setReplyBody] = useState('')
  const [decisionReason, setDecisionReason] = useState('')
  const [decisionMinutes, setDecisionMinutes] = useState(0)
  const [decisionMode, setDecisionMode] = useState<'approve' | 'reject' | null>(null)
  const [busy, setBusy] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [newestFirst, setNewestFirst] = useState(true)
  const [cursor, setCursor] = useState(-1)
  const threadRef = useRef<HTMLDivElement>(null)
  const replyRef = useRef<HTMLTextAreaElement>(null)
  const loadedIdRef = useRef('')
  // The rail counts every view, so the list is fetched whole and sorted here.
  const { data, meta, loading, error, reload } = useCollection<Message>('/api/messages', { search, page, filters: { filter: 'all', per_page: 100 } })

  // `quiet` refreshes the open conversation in place. Without it every list
  // reload would swap the thread for a spinner and lose the reader's place.
  const openMessage = useCallback(async (id: EntityId, quiet = false) => {
    if (!quiet) setDetailLoading(true)
    setDetailError('')
    try {
      const response = await api.get<ApiEnvelope<Message> | Message>(`/api/messages/${id}`)
      const message = unwrap(response)
      setSelected(message)
      const request = estimateRequest(message)
      setDecisionMinutes(request ? requestedMinutes(request) : 0)
      setDecisionReason('')
      setDecisionMode(null)
      setReplyBody('')
      if (isUnread(message)) {
        const marked = await api.patch<ApiEnvelope<Message> | Message>(`/api/messages/${id}/read`)
        setSelected(unwrap(marked))
        void reload()
      }
    } catch (reason) {
      setDetailError(reason instanceof Error ? reason.message : 'Unable to open this conversation.')
    } finally {
      setDetailLoading(false)
    }
  }, [reload])

  useEffect(() => {
    if (!messageId || messageId === 'oliver') {
      loadedIdRef.current = ''
      setSelected(null)
      return
    }
    if (loadedIdRef.current === String(messageId)) return
    loadedIdRef.current = String(messageId)
    void openMessage(messageId)
  }, [messageId, openMessage])

  useEffect(() => {
    const request = selected ? estimateRequest(selected) : null
    if (!selected || !request || reviewMode(request) !== 'ai' || !['queued', 'running'].includes(aiState(request) ?? '')) return
    const timer = window.setInterval(async () => {
      try {
        const response = await api.get<ApiEnvelope<Message> | Message>(`/api/messages/${selected.id}`)
        setSelected(unwrap(response))
        void reload()
      } catch { /* Keep the current conversation visible while polling recovers. */ }
    }, 3000)
    return () => window.clearInterval(timer)
  }, [selected, reload])

  const matchesView = useCallback((message: Message, key: ViewKey) => {
    const request = estimateRequest(message)
    switch (key) {
      case 'needs-reply': return isUnread(message)
      case 'estimates': return Boolean(request)
      case 'estimate-requests': return request?.status === 'pending'
      case 'overdue': return isOverdue(message.task)
      case 'assigned-to-me': return String(message.task?.assignee?.id ?? '') === String(user?.id ?? '')
      default: return true
    }
  }, [user?.id])

  const counts = useMemo(() => {
    const keys: ViewKey[] = ['needs-reply', 'estimates', 'all', 'estimate-requests', 'overdue', 'assigned-to-me']
    return Object.fromEntries(keys.map((key) => [key, data.filter((message) => matchesView(message, key)).length])) as Record<ViewKey, number>
  }, [data, matchesView])

  const visibleMessages = useMemo(() => {
    const rows = data.filter((message) => matchesView(message, view))
    const stamp = (message: Message) => new Date((message.latestMessage ?? message.latest_message ?? message)?.createdAt ?? (message.latestMessage ?? message.latest_message ?? message)?.created_at ?? 0).getTime()
    return [...rows].sort((a, b) => (newestFirst ? stamp(b) - stamp(a) : stamp(a) - stamp(b)))
  }, [data, matchesView, view, newestFirst])

  // Rows sort themselves into what wants an answer and what does not, so there
  // is no filter to set before the list is useful.
  const groups = useMemo(() => {
    const needsYou = visibleMessages.filter((message) => isUnread(message))
    const rest = visibleMessages.filter((message) => !isUnread(message))
    return [
      { key: 'needs-you', label: 'Needs you', rows: needsYou },
      { key: 'rest', label: needsYou.length ? 'Everything else' : 'Conversations', rows: rest },
    ].filter((group) => group.rows.length > 0)
  }, [visibleMessages])

  const orderedRows = useMemo(() => groups.flatMap((group) => group.rows), [groups])

  useEffect(() => {
    const thread = threadRef.current
    if (thread) thread.scrollTop = thread.scrollHeight
  }, [selected])

  useEffect(() => { setPicked(new Set()) }, [view])

  const setView = (next: ViewKey) => {
    const params = new URLSearchParams(searchParams)
    params.set('view', next)
    setSearchParams(params)
    setPage(1)
  }

  const openRow = useCallback((message: Message) => {
    navigate(`/messages/${message.id}?view=${view}`)
  }, [navigate, view])

  // J/K/R/X/Enter, ignored while the caret is in a field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
      const key = event.key.toLowerCase()
      if (key === 'j' || key === 'k') {
        event.preventDefault()
        setCursor((current) => {
          const next = key === 'j' ? Math.min(orderedRows.length - 1, current + 1) : Math.max(0, current - 1)
          return orderedRows.length ? next : -1
        })
        return
      }
      const row = orderedRows[cursor]
      if (!row) return
      if (key === 'enter') { event.preventDefault(); openRow(row) }
      if (key === 'x') {
        event.preventDefault()
        setPicked((current) => {
          const next = new Set(current)
          if (next.has(String(row.id))) next.delete(String(row.id))
          else next.add(String(row.id))
          return next
        })
      }
      if (key === 'r') { event.preventDefault(); replyRef.current?.focus() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cursor, orderedRows, openRow])

  const markAll = async () => {
    try {
      await api.post('/api/messages/mark-all-read')
      await reload()
      if (selected) setSelected({ ...selected, unread_count: 0 })
    } catch (reason) {
      setDetailError(reason instanceof Error ? reason.message : 'Unable to mark messages as read.')
    }
  }

  const markPickedRead = async () => {
    setBusy(true)
    try {
      await Promise.all([...picked].map((id) => api.patch(`/api/messages/${id}/read`)))
      setPicked(new Set())
      await reload()
    } catch (reason) {
      setDetailError(reason instanceof Error ? reason.message : 'Unable to mark those as read.')
    } finally { setBusy(false) }
  }

  const toggleUnread = async () => {
    if (!selected) return
    const unread = isUnread(selected)
    const response = await api.patch<ApiEnvelope<Message> | Message>(`/api/messages/${selected.id}/${unread ? 'read' : 'unread'}`)
    setSelected(unwrap(response))
    await reload()
  }

  const sendReply = async () => {
    if (!selected || !replyBody.trim()) return
    setBusy(true); setDetailError('')
    try {
      await api.post(`/api/messages/${selected.id}/replies`, { body: replyBody.trim() })
      await openMessage(selected.id, true)
      await reload()
    } catch (reason) {
      setDetailError(reason instanceof Error ? reason.message : 'Unable to send the reply.')
    } finally { setBusy(false) }
  }

  const decide = async (decision: 'approve' | 'reject') => {
    const request = selected && estimateRequest(selected)
    if (!selected?.task || !request || !decisionReason.trim()) return
    setBusy(true); setDetailError('')
    try {
      await api.post(`/api/tasks/${selected.task.id}/estimate-requests/${request.id}/${decision}`, {
        reason: decisionReason.trim(),
        ...(decision === 'approve' ? { approved_additional_minutes: decisionMinutes } : {}),
      })
      await openMessage(selected.id, true)
      await reload()
    } catch (reason) {
      setDetailError(reason instanceof Error ? reason.message : `Unable to ${decision} this request.`)
    } finally { setBusy(false) }
  }

  const overrideDecision = async (decision: 'approve' | 'reject') => {
    const request = selected && estimateRequest(selected)
    if (!selected?.task || !request || !decisionReason.trim()) return
    setBusy(true); setDetailError('')
    try {
      await api.post(`/api/tasks/${selected.task.id}/estimate-requests/${request.id}/override`, {
        action: decision,
        reason: decisionReason.trim(),
        ...(decision === 'approve' ? { approved_additional_minutes: decisionMinutes } : {}),
      })
      await openMessage(selected.id, true)
      await reload()
    } catch (reason) {
      setDetailError(reason instanceof Error ? reason.message : 'Unable to override the AI decision.')
    } finally { setBusy(false) }
  }

  const selectedRequest = selected ? estimateRequest(selected) : null
  const selectedAiState = selectedRequest ? aiState(selectedRequest) : null
  const aiReview = selectedRequest ? reviewMode(selectedRequest) === 'ai' : false
  const canReview = Boolean(selected?.canReview ?? selected?.can_review) && selectedRequest?.status === 'pending'
    && (!aiReview || ['failed', 'budget_blocked'].includes(selectedAiState ?? ''))
  const canOverride = Boolean(selected?.canOverride ?? selected?.can_override)
  const decisionKind = canReview ? 'review' : canOverride ? 'override' : null
  const partner = selected ? counterpart(selected, user?.id) : undefined
  const threadMessages = selected?.messages ?? (selected ? [selected] : [])
  const threadFiles = threadMessages.flatMap((message) => message.attachments ?? [])
  const task = selected?.task
  const loggedMinutes = Number(task?.actual_minutes ?? 0)
  const estimateMinutes = Number(task?.estimated_minutes ?? 0)
  const aiStatusLine = selectedAiState === 'queued' || selectedAiState === 'running' ? 'Strict review in progress…'
    : selectedAiState === 'waiting_employee' ? 'Waiting for the employee to answer its challenge.'
      : selectedAiState === 'budget_blocked' ? 'Monthly budget reached; a human manager can decide.'
        : selectedAiState === 'failed' ? 'Review failed; a human manager can decide.'
          : selectedAiState === 'overridden' ? 'The AI decision was overridden by a manager.'
            : selectedAiState === 'decided' ? 'Decision completed and logged.' : 'Enabled for this request.'
  const runDecision = decisionKind === 'override' ? overrideDecision : decide

  return (
    <div className="triage">
      <header className="triage-bar">
        <strong>Messages</strong>
        <label className="message-search"><Icon name="search" size={16} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search conversations…" /></label>
        <div className="triage-bar-actions">
          <button className="btn btn-quiet" onClick={() => void markAll()}><Icon name="check" size={15} /> Mark all read</button>
          {can('tasks.comment') && <button className="btn btn-primary" onClick={() => setComposerOpen(true)}><Icon name="plus" size={15} /> New message</button>}
        </div>
      </header>
      <NewMessageModal open={composerOpen} onClose={() => setComposerOpen(false)} onStarted={async (conversation) => { setComposerOpen(false); await reload(); navigate(`/messages/${conversation.id}?view=all`) }} />
      {detailError && <ErrorBanner message={detailError} />}

      <section className="triage-body">
        <nav className="triage-views" aria-label="Conversation views">
          <div className="triage-view-group">
            <span className="triage-view-kicker">Inbox</span>
            {INBOX_VIEWS.map((item) => (
              <button key={item.key} className={view === item.key ? 'active' : ''} onClick={() => setView(item.key)}>
                {item.label}<b>{counts[item.key]}</b>
              </button>
            ))}
          </div>
          <div className="triage-view-group">
            <span className="triage-view-kicker">Smart views</span>
            {SMART_VIEWS.map((item) => (
              <button key={item.key} className={view === item.key ? 'active' : ''} onClick={() => setView(item.key)}>
                {item.label}<b className={item.tone ?? ''}>{counts[item.key]}</b>
              </button>
            ))}
          </div>
          <button className={`oliver-entry ${oliverOpen ? 'active' : ''}`} onClick={() => navigate('/messages/oliver')}>
            <span className="oliver-avatar">O</span>
            <div><span className="message-list-head"><strong>Oliver</strong></span><p>Your AI project manager</p></div>
          </button>
          <div className="triage-shortcuts">
            <span className="triage-view-kicker">Shortcuts</span>
            {SHORTCUTS.map(([keys, meaning]) => <p key={keys}><span>{keys}</span><small>{meaning}</small></p>)}
          </div>
        </nav>

        <div className="triage-list">
          <div className="triage-list-head">
            <label className="triage-check">
              <input
                type="checkbox"
                aria-label="Select all conversations"
                checked={visibleMessages.length > 0 && picked.size === visibleMessages.length}
                onChange={(event) => setPicked(event.target.checked ? new Set(visibleMessages.map((message) => String(message.id))) : new Set())}
              />
            </label>
            <span>{picked.size ? `${picked.size} selected` : `${visibleMessages.length} conversation${visibleMessages.length === 1 ? '' : 's'}`}</span>
            <div className="triage-list-actions">
              {picked.size > 0 && <button disabled={busy} onClick={() => void markPickedRead()}>Read</button>}
              <button onClick={() => setNewestFirst((current) => !current)}>{newestFirst ? 'Newest first' : 'Oldest first'}</button>
            </div>
          </div>
          {error && <ErrorBanner message={error} onRetry={() => void reload()} />}
          <div className="message-list">
            {loading ? Array.from({ length: 6 }, (_, index) => <div className="message-skeleton" key={index}><span className="skeleton circle"/><div><span className="skeleton"/><span className="skeleton short"/></div></div>)
              : orderedRows.length ? groups.map((group) => (
                <div key={group.key}>
                  <div className="triage-group"><span>{group.label}</span><i /><b>{group.rows.length}</b></div>
                  {group.rows.map((message) => {
                    const latest = message.latestMessage ?? message.latest_message ?? message
                    const person = counterpart(message, user?.id)
                    const lastFromMe = String(latest.author?.id ?? latest.createdBy ?? latest.created_by) === String(user?.id)
                    const request = estimateRequest(message)
                    const id = String(message.id)
                    return (
                      <div
                        key={message.id}
                        className={`triage-row ${isUnread(message) ? 'unread' : ''} ${id === String(messageId) ? 'active' : ''} ${cursor === orderedRows.indexOf(message) ? 'cursor' : ''}`.replace(/\s+/g, ' ').trim()}
                        role="button"
                        tabIndex={0}
                        onClick={() => openRow(message)}
                        onKeyDown={(event) => { if (event.key === 'Enter') openRow(message) }}
                      >
                        <label className="triage-check" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`Select conversation with ${displayName(person)}`}
                            checked={picked.has(id)}
                            onChange={(event) => setPicked((current) => {
                              const next = new Set(current)
                              if (event.target.checked) next.add(id)
                              else next.delete(id)
                              return next
                            })}
                          />
                        </label>
                        <Avatar user={person} size={34} />
                        <div className="triage-row-body">
                          <span className="message-list-head"><strong>{displayName(person)}</strong><time>{shortAge(latest)}</time></span>
                          <b>{request ? <span className="row-tag">Estimate</span> : null}<span>{message.task?.title || message.subject || 'Task message'}</span></b>
                          <p>{lastFromMe ? <span className="row-prefix">You:</span> : null}{latest.body}</p>
                        </div>
                        {isUnread(message) && <span className={`unread-dot ${request?.status === 'pending' ? 'is-decision' : ''}`.trim()} />}
                      </div>
                    )
                  })}
                </div>
              )) : <EmptyState title={view === 'needs-reply' ? 'You’re all caught up' : 'Nothing in this view'} description={view === 'needs-reply' ? 'New replies and estimate requests land here.' : 'Try another view, or start a conversation.'} action={can('tasks.comment') ? <button className="btn btn-quiet" onClick={() => setComposerOpen(true)}><Icon name="plus" size={15} /> Start a conversation</button> : undefined} />}
          </div>
          {(meta.lastPage ?? 1) > 1 && <div className="message-list-footer"><button disabled={meta.page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {meta.page} of {meta.lastPage ?? 1}</span><button disabled={meta.page >= (meta.lastPage ?? 1)} onClick={() => setPage((value) => value + 1)}>Next</button></div>}
        </div>

        <article className={`message-detail ${oliverOpen ? 'is-oliver' : ''}`.trim()}>
          {oliverOpen ? <OliverChat /> : detailLoading ? <div className="detail-loading"><span className="spinner" /> Opening conversation…</div> : selected ? (
            <>
              <header className="conversation-header">
                <Avatar user={partner} size={36} />
                <div className="conversation-identity">
                  <strong>{displayName(partner)}</strong>
                  <span>
                    {selectedRequest ? <span className="row-tag">Estimate</span> : null}
                    {selected.task && can('tasks.view')
                      ? <Link to={`/tasks/${selected.task.id}`}>{selected.task.title}</Link>
                      : selected.task?.title || selected.subject || 'Task conversation'}
                  </span>
                </div>
                <div className="conversation-header-actions">
                  <button className="key-button" onClick={() => replyRef.current?.focus()}>Reply <span>R</span></button>
                  <button className="key-button" onClick={() => void toggleUnread()}>{isUnread(selected) ? 'Mark read' : 'Mark unread'}</button>
                </div>
              </header>

              <div className="conversation-thread" ref={threadRef}>
                {threadMessages.map((message, index) => {
                  const mine = String(message.author?.id ?? message.createdBy ?? message.created_by) === String(user?.id)
                  const actor = message.actorName ?? message.actor_name ?? displayName(message.author)
                  const isAi = (message.actorType ?? message.actor_type) === 'ai'
                  const isSystem = (message.actorType ?? message.actor_type) === 'system'
                  const previous = threadMessages[index - 1]
                  const newDay = dayLabel(message) !== dayLabel(previous)
                  // Consecutive lines from the same person read as one turn, so the
                  // name and avatar only repeat when the speaker or the day changes.
                  const sameSpeaker = !newDay && previous && String(previous.author?.id ?? previous.createdBy ?? previous.created_by) === String(message.author?.id ?? message.createdBy ?? message.created_by)
                    && (previous.actorType ?? previous.actor_type) === (message.actorType ?? message.actor_type)
                  return (
                    <div key={message.id}>
                      {newDay && <div className="thread-day"><span>{dayLabel(message)}</span></div>}
                      {isSystem ? (
                        <p className="thread-system">{message.body}</p>
                      ) : (
                        <article className={`${mine ? 'mine' : ''} ${isAi ? 'ai-message' : ''} ${sameSpeaker ? 'continued' : ''}`.replace(/\s+/g, ' ').trim()}>
                          {!sameSpeaker && (
                            <div className="conversation-author">
                              <Avatar user={message.author} size={28} />
                              <div><strong>{actor}</strong>{isAi && <span className="ai-actor-badge">AI</span>}<time>{noteTime(message)}</time></div>
                            </div>
                          )}
                          <div className="conversation-bubble" title={noteTime(message)}>{message.body.split('\n').map((line, lineIndex) => <p key={lineIndex}>{line || <br />}</p>)}</div>
                          {(message.attachments?.length ?? 0) > 0 && (
                            <ul className="thread-files">
                              {message.attachments?.map((file) => <li key={file.id}><Icon name="paperclip" size={13} />{file.url ? <a href={file.url} target="_blank" rel="noreferrer">{attachmentName(file)}</a> : <span>{attachmentName(file)}</span>}</li>)}
                            </ul>
                          )}
                        </article>
                      )}
                    </div>
                  )
                })}

                {/* The estimate decision happens in the thread, where the ask was made. */}
                {selectedRequest && (
                  <section className="estimate-card">
                    <div className="estimate-card-facts">
                      <div><span>Requested</span><strong><Minutes value={requestedMinutes(selectedRequest)} /></strong></div>
                      <div><span>Estimate then</span><strong><Minutes value={selectedRequest.baseEstimatedMinutes ?? selectedRequest.base_estimated_minutes ?? 0} /></strong></div>
                      {selectedRequest.status === 'approved' && <div><span>Approved</span><strong><Minutes value={approvedMinutes(selectedRequest)} /></strong></div>}
                      <StatusBadge value={selectedRequest.status} />
                    </div>
                    {aiReview && <p className="estimate-card-note"><strong>AI project manager:</strong> {aiStatusLine}</p>}
                    {selectedRequest.status === 'replaced' && <p className="estimate-card-note">This request was replaced by a newer request.</p>}
                    {decisionKind && !decisionMode && (
                      <div className="estimate-card-actions">
                        <button className="btn btn-primary" onClick={() => { setDecisionMode('approve'); setDecisionMinutes(requestedMinutes(selectedRequest)) }}>
                          <Icon name="check" size={15} /> {decisionKind === 'override' ? 'Override as approved' : 'Approve'} <Minutes value={requestedMinutes(selectedRequest)} />
                        </button>
                        <button className="btn btn-quiet" onClick={() => setDecisionMode('reject')}>{decisionKind === 'override' ? 'Override as rejected' : 'Reject'}</button>
                      </div>
                    )}
                    {decisionKind && decisionMode && (
                      <div className="estimate-card-form">
                        {decisionMode === 'approve' && (
                          <label><span>Approved additional minutes</span><input type="number" min="1" max={decisionKind === 'override' ? requestedMinutes(selectedRequest) : undefined} value={decisionMinutes} onChange={(event) => setDecisionMinutes(Number(event.target.value))} /></label>
                        )}
                        <label><span>{decisionKind === 'override' ? 'Reason for override' : `Why are you ${decisionMode === 'approve' ? 'approving' : 'rejecting'} it?`}</span><textarea value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} placeholder="This is kept in the decision history…" /></label>
                        <div className="estimate-card-actions">
                          <button className="btn btn-quiet" onClick={() => { setDecisionMode(null); setDecisionReason('') }}>Cancel</button>
                          <button className="btn btn-primary" disabled={busy || !decisionReason.trim() || (decisionMode === 'approve' && decisionMinutes < 1)} onClick={() => void runDecision(decisionMode)}>
                            {busy ? 'Saving…' : decisionMode === 'approve' ? 'Approve & update estimate' : 'Reject request'}
                          </button>
                        </div>
                      </div>
                    )}
                    {selectedRequest.decisions?.length ? (
                      <details className="estimate-history">
                        <summary>Decision history ({selectedRequest.decisions.length})</summary>
                        {selectedRequest.decisions.map((decision) => <div key={decision.id}><strong>{decision.source === 'ai' ? 'AI project manager' : decision.source === 'human_override' ? 'Human override' : decision.source === 'system' ? 'System' : displayName(decision.decider)}</strong><span>{decision.action}{decision.action === 'approve' ? ` · ${decision.approvedAdditionalMinutes ?? decision.approved_additional_minutes ?? 0} minutes` : ''}</span><p>{decision.reason}</p></div>)}
                      </details>
                    ) : null}
                  </section>
                )}
              </div>

              {can('tasks.comment') ? (
                <section className="conversation-reply">
                  <textarea
                    ref={replyRef}
                    value={replyBody}
                    disabled={busy}
                    aria-label="Reply in this conversation"
                    placeholder={`Reply to ${displayName(partner)}…  (Enter to send)`}
                    onChange={(event) => setReplyBody(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendReply() } }}
                  />
                  <button className="btn btn-primary" disabled={busy || !replyBody.trim()} onClick={() => void sendReply()}><Icon name="send" size={15} /> {busy ? 'Sending…' : 'Send'}</button>
                </section>
              ) : <p className="read-only-note">Your role can read this conversation but cannot reply.</p>}
            </>
          ) : (
            <div className="message-placeholder">
              <span><Icon name="inbox" size={34} /></span>
              <h2>Select a conversation</h2>
              <p>Pick one on the left, ask Oliver, or start a new conversation with someone.</p>
              {can('tasks.comment') && <button className="btn btn-primary" onClick={() => setComposerOpen(true)}><Icon name="plus" size={15} /> Start a conversation</button>}
            </div>
          )}
        </article>

        {/* Task context, pinned instead of hidden behind "Open task". */}
        {selected && !oliverOpen && task && (
          <aside className="triage-context" aria-label="Task context">
            <section>
              <span className="triage-view-kicker">Task</span>
              <strong>{task.title}</strong>
              <div className="triage-context-line">
                {task.status_value && <StatusBadge value={task.status_value.label} />}
                {task.due_date && <span className={isOverdue(task) ? 'is-overdue' : ''}>Due {new Date(task.due_date).toLocaleDateString([], { day: 'numeric', month: 'short' })}</span>}
              </div>
              {task.project?.name && <p className="triage-context-line"><Icon name="briefcase" size={14} /> {task.project.name}</p>}
              {can('tasks.view') && <Link className="btn btn-quiet" to={`/tasks/${task.id}`}>Open task</Link>}
            </section>
            <section>
              <span className="triage-view-kicker">Time</span>
              <p className="triage-time"><strong><Minutes value={loggedMinutes} /></strong> {estimateMinutes > 0 && <small>of <Minutes value={estimateMinutes} /> estimate</small>}</p>
              {estimateMinutes > 0 && (
                <div className="triage-meter" role="img" aria-label={`${Math.round((loggedMinutes / estimateMinutes) * 100)} percent of the estimate used`}>
                  <i className={loggedMinutes > estimateMinutes ? 'over' : ''} style={{ width: `${Math.min(100, Math.round((loggedMinutes / estimateMinutes) * 100))}%` }} />
                </div>
              )}
              {task.assignee && <p className="triage-context-line"><Icon name="profile" size={14} /> {displayName(task.assignee)}</p>}
            </section>
            {threadFiles.length > 0 && (
              <section>
                <span className="triage-view-kicker">Files in thread</span>
                <ul className="triage-files">
                  {threadFiles.map((file) => <li key={file.id}><Icon name="paperclip" size={13} />{file.url ? <a href={file.url} target="_blank" rel="noreferrer">{attachmentName(file)}</a> : <span>{attachmentName(file)}</span>}</li>)}
                </ul>
              </section>
            )}
          </aside>
        )}
      </section>
    </div>
  )
}
