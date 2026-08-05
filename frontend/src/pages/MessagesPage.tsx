import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import {
  Briefcase,
  Check,
  Inbox,
  Paperclip,
  Plus,
  Search,
  Send,
  UserRound,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { Avatar, EmptyState, ErrorBanner, Minutes, StatusBadge } from '@/components/shared'
import { OliverChat } from '@/components/OliverChat'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { api, displayName, normalizePage, unwrap } from '@/lib/api'
import { useCollection } from '@/lib/useCollection'
import { useCan } from '@/lib/permissions'
import type { ApiEnvelope, Attachment, EntityId, EstimateRequest, Message, Note, Paginated, Task, UserSummary } from '@/types/api'

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

function attachmentList(files: Attachment[]) {
  return (
    <ul className="space-y-1">
      {files.map((file) => (
        <li key={file.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Paperclip className="size-3.5 shrink-0" />
          {file.url ? (
            <a href={file.url} target="_blank" rel="noreferrer" className="truncate underline-offset-2 hover:underline">
              {attachmentName(file)}
            </a>
          ) : (
            <span className="truncate">{attachmentName(file)}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

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
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New conversation</DialogTitle>
          <DialogDescription>Conversations are attached to a task so both of you share the same context.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Send to</Label>
            <Select value={recipientId} onValueChange={setRecipientId}>
              <SelectTrigger aria-label="Send to" className="w-full">
                <SelectValue placeholder="Choose a person…" />
              </SelectTrigger>
              <SelectContent>
                {recipients.map((person) => <SelectItem key={person.id} value={String(person.id)}>{displayName(person)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-message-task-search">Search tasks</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="new-message-task-search" className="pl-8" value={taskSearch} onChange={(event) => setTaskSearch(event.target.value)} placeholder="Search tasks…" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>About task</Label>
            <Select value={taskId} onValueChange={setTaskId}>
              <SelectTrigger aria-label="About task" className="w-full">
                <SelectValue placeholder={tasks.length ? 'Choose a task…' : 'No tasks match'} />
              </SelectTrigger>
              <SelectContent>
                {tasks.map((task) => <SelectItem key={task.id} value={String(task.id)}>{task.project?.name ? `${task.title} · ${task.project.name}` : task.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-message-body">Message</Label>
            <Textarea id="new-message-body" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write your message…" rows={5} />
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={busy || !recipientId || !taskId || !body.trim()} onClick={() => void send()}>
            <Send /> {busy ? 'Sending…' : 'Send message'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Messages</h1>
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1) }}
            placeholder="Search conversations…"
            aria-label="Search conversations"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => void markAll()}><Check /> Mark all read</Button>
          {can('tasks.comment') && <Button onClick={() => setComposerOpen(true)}><Plus /> New message</Button>}
        </div>
      </div>

      <NewMessageModal open={composerOpen} onClose={() => setComposerOpen(false)} onStarted={async (conversation) => { setComposerOpen(false); await reload(); navigate(`/messages/${conversation.id}?view=all`) }} />
      {detailError && <ErrorBanner message={detailError} />}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[200px_320px_1fr] xl:grid-cols-[200px_340px_1fr_260px]">
        <nav aria-label="Conversation views" className="flex flex-col gap-4 lg:overflow-y-auto">
          <div className="space-y-1">
            <p className="px-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">Inbox</p>
            {INBOX_VIEWS.map((item) => (
              <Button
                key={item.key}
                variant={view === item.key ? 'secondary' : 'ghost'}
                className="w-full justify-between"
                onClick={() => setView(item.key)}
              >
                {item.label}
                <Badge variant="outline">{counts[item.key]}</Badge>
              </Button>
            ))}
          </div>
          <div className="space-y-1">
            <p className="px-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">Smart views</p>
            {SMART_VIEWS.map((item) => (
              <Button
                key={item.key}
                variant={view === item.key ? 'secondary' : 'ghost'}
                className="w-full justify-between"
                onClick={() => setView(item.key)}
              >
                {item.label}
                <Badge variant={item.tone === 'danger' ? 'destructive' : 'outline'} className={item.tone === 'warning' ? 'border-warning text-warning' : undefined}>
                  {counts[item.key]}
                </Badge>
              </Button>
            ))}
          </div>
          <Button
            variant={oliverOpen ? 'secondary' : 'outline'}
            className="h-auto w-full justify-start gap-2 py-2"
            onClick={() => navigate('/messages/oliver')}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">O</span>
            <span className="flex flex-col items-start">
              <strong className="text-sm font-medium">Oliver</strong>
              <span className="text-xs text-muted-foreground">Your AI project manager</span>
            </span>
          </Button>
          <div className="space-y-1 text-xs text-muted-foreground">
            <p className="px-2 font-medium uppercase tracking-widest">Shortcuts</p>
            {SHORTCUTS.map(([keys, meaning]) => (
              <p key={keys} className="flex items-center justify-between px-2">
                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[0.7rem]">{keys}</kbd>
                <span>{meaning}</span>
              </p>
            ))}
          </div>
        </nav>

        <Card className="flex min-h-0 flex-col gap-0 py-0">
          <div className="flex items-center gap-2 border-b p-3">
            <Checkbox
              aria-label="Select all conversations"
              checked={visibleMessages.length > 0 && picked.size === visibleMessages.length}
              onCheckedChange={(checked) => setPicked(checked ? new Set(visibleMessages.map((message) => String(message.id))) : new Set())}
            />
            <span className="flex-1 text-sm text-muted-foreground">
              {picked.size ? `${picked.size} selected` : `${visibleMessages.length} conversation${visibleMessages.length === 1 ? '' : 's'}`}
            </span>
            {picked.size > 0 && <Button size="sm" variant="outline" disabled={busy} onClick={() => void markPickedRead()}>Read</Button>}
            <Button size="sm" variant="ghost" onClick={() => setNewestFirst((current) => !current)}>{newestFirst ? 'Newest first' : 'Oldest first'}</Button>
          </div>
          {error && <div className="p-3"><ErrorBanner message={error} onRetry={() => void reload()} /></div>}
          <ScrollArea className="min-h-0 flex-1">
            {loading ? (
              <div className="space-y-3 p-3">
                {Array.from({ length: 6 }, (_, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <Skeleton className="size-8 shrink-0 rounded-full" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3 w-2/3" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : orderedRows.length ? groups.map((group) => (
              <div key={group.key}>
                <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground">
                  <span>{group.label}</span>
                  <span className="h-px flex-1 bg-border" />
                  <span>{group.rows.length}</span>
                </div>
                {group.rows.map((message) => {
                  const latest = message.latestMessage ?? message.latest_message ?? message
                  const person = counterpart(message, user?.id)
                  const lastFromMe = String(latest.author?.id ?? latest.createdBy ?? latest.created_by) === String(user?.id)
                  const request = estimateRequest(message)
                  const id = String(message.id)
                  const unread = isUnread(message)
                  return (
                    <div
                      key={message.id}
                      className={cn(
                        'flex cursor-pointer items-start gap-2.5 border-b px-3 py-2.5 transition-colors hover:bg-accent/60',
                        id === String(messageId) && 'bg-accent',
                        cursor === orderedRows.indexOf(message) && 'ring-1 ring-inset ring-ring',
                      )}
                      role="button"
                      tabIndex={0}
                      onClick={() => openRow(message)}
                      onKeyDown={(event) => { if (event.key === 'Enter') openRow(message) }}
                    >
                      <span onClick={(event) => event.stopPropagation()} className="pt-1.5">
                        <Checkbox
                          aria-label={`Select conversation with ${displayName(person)}`}
                          checked={picked.has(id)}
                          onCheckedChange={(checked) => setPicked((current) => {
                            const next = new Set(current)
                            if (checked) next.add(id)
                            else next.delete(id)
                            return next
                          })}
                        />
                      </span>
                      <Avatar user={person} className="size-8 shrink-0" />
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <strong className={cn('truncate text-sm', unread && 'font-semibold')}>{displayName(person)}</strong>
                          <time className="shrink-0 text-xs text-muted-foreground">{shortAge(latest)}</time>
                        </div>
                        <p className="flex items-center gap-1.5 truncate text-sm">
                          {request ? <Badge variant="outline" className="shrink-0">Estimate</Badge> : null}
                          <span className="truncate">{message.task?.title || message.subject || 'Task message'}</span>
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{lastFromMe ? <span className="font-medium">You: </span> : null}{latest.body}</p>
                      </div>
                      {unread && (
                        <span
                          aria-hidden="true"
                          className={cn('mt-1.5 size-2 shrink-0 rounded-full', request?.status === 'pending' ? 'bg-warning' : 'bg-primary')}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            )) : (
              <div className="p-6">
                <EmptyState
                  icon={Inbox}
                  title={view === 'needs-reply' ? 'You’re all caught up' : 'Nothing in this view'}
                  description={view === 'needs-reply' ? 'New replies and estimate requests land here.' : 'Try another view, or start a conversation.'}
                  action={can('tasks.comment') ? <Button variant="outline" onClick={() => setComposerOpen(true)}><Plus /> Start a conversation</Button> : undefined}
                />
              </div>
            )}
          </ScrollArea>
          {(meta.lastPage ?? 1) > 1 && (
            <div className="flex items-center justify-between border-t p-2 text-sm">
              <Button size="sm" variant="outline" disabled={meta.page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button>
              <span className="text-muted-foreground">Page {meta.page} of {meta.lastPage ?? 1}</span>
              <Button size="sm" variant="outline" disabled={meta.page >= (meta.lastPage ?? 1)} onClick={() => setPage((value) => value + 1)}>Next</Button>
            </div>
          )}
        </Card>

        <Card className="flex min-h-0 flex-col gap-0 py-0">
          {oliverOpen ? <OliverChat /> : detailLoading ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Skeleton className="size-4 rounded-full" /> Opening conversation…
            </div>
          ) : selected ? (
            <>
              <header className="flex items-center gap-3 border-b p-3">
                <Avatar user={partner} className="size-9" />
                <div className="min-w-0 flex-1">
                  <strong className="block truncate">{displayName(partner)}</strong>
                  <span className="flex items-center gap-1.5 truncate text-sm text-muted-foreground">
                    {selectedRequest ? <Badge variant="outline">Estimate</Badge> : null}
                    {selected.task && can('tasks.view')
                      ? <Link to={`/tasks/${selected.task.id}`} className="truncate hover:underline">{selected.task.title}</Link>
                      : <span className="truncate">{selected.task?.title || selected.subject || 'Task conversation'}</span>}
                  </span>
                </div>
                <Button variant="outline" size="sm" onClick={() => replyRef.current?.focus()}>Reply <kbd className="font-mono text-xs">R</kbd></Button>
                <Button variant="outline" size="sm" onClick={() => void toggleUnread()}>{isUnread(selected) ? 'Mark read' : 'Mark unread'}</Button>
              </header>

              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-3 p-4" ref={threadRef}>
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
                        {newDay && (
                          <div className="my-3 flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="h-px flex-1 bg-border" /><span>{dayLabel(message)}</span><span className="h-px flex-1 bg-border" />
                          </div>
                        )}
                        {isSystem ? (
                          <p className="text-center text-xs text-muted-foreground">{message.body}</p>
                        ) : (
                          <div className={cn('flex flex-col gap-1', mine && 'items-end')}>
                            {!sameSpeaker && (
                              <div className={cn('flex items-center gap-2', mine && 'flex-row-reverse')}>
                                <Avatar user={message.author} className="size-6" />
                                <strong className="text-xs">{actor}</strong>
                                {isAi && <Badge variant="outline" className="text-[0.65rem]">AI</Badge>}
                                <time className="text-xs text-muted-foreground">{noteTime(message)}</time>
                              </div>
                            )}
                            <div
                              title={noteTime(message)}
                              className={cn(
                                'max-w-[85%] rounded-lg px-3 py-2 text-sm',
                                mine ? 'bg-primary text-primary-foreground' : isAi ? 'border border-dashed bg-muted' : 'bg-muted',
                              )}
                            >
                              {message.body.split('\n').map((line, lineIndex) => <p key={lineIndex}>{line || <br />}</p>)}
                            </div>
                            {(message.attachments?.length ?? 0) > 0 && attachmentList(message.attachments ?? [])}
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {/* The estimate decision happens in the thread, where the ask was made. */}
                  {selectedRequest && (
                    <Card className="gap-3 py-4">
                      <div className="flex flex-wrap items-center gap-4 px-4 text-sm">
                        <div><span className="text-xs text-muted-foreground">Requested</span><br /><strong><Minutes value={requestedMinutes(selectedRequest)} /></strong></div>
                        <div><span className="text-xs text-muted-foreground">Estimate then</span><br /><strong><Minutes value={selectedRequest.baseEstimatedMinutes ?? selectedRequest.base_estimated_minutes ?? 0} /></strong></div>
                        {selectedRequest.status === 'approved' && <div><span className="text-xs text-muted-foreground">Approved</span><br /><strong><Minutes value={approvedMinutes(selectedRequest)} /></strong></div>}
                        <StatusBadge value={selectedRequest.status} />
                      </div>
                      {aiReview && <p className="px-4 text-sm text-muted-foreground"><strong className="text-foreground">AI project manager:</strong> {aiStatusLine}</p>}
                      {selectedRequest.status === 'replaced' && <p className="px-4 text-sm text-muted-foreground">This request was replaced by a newer request.</p>}
                      {decisionKind && !decisionMode && (
                        <div className="flex flex-wrap gap-2 px-4">
                          <Button onClick={() => { setDecisionMode('approve'); setDecisionMinutes(requestedMinutes(selectedRequest)) }}>
                            <Check /> {decisionKind === 'override' ? 'Override as approved' : 'Approve'} <Minutes value={requestedMinutes(selectedRequest)} />
                          </Button>
                          <Button variant="outline" onClick={() => setDecisionMode('reject')}>{decisionKind === 'override' ? 'Override as rejected' : 'Reject'}</Button>
                        </div>
                      )}
                      {decisionKind && decisionMode && (
                        <div className="space-y-3 px-4">
                          {decisionMode === 'approve' && (
                            <div className="space-y-1.5">
                              <Label htmlFor="decision-minutes">Approved additional minutes</Label>
                              <Input
                                id="decision-minutes"
                                type="number"
                                min="1"
                                max={decisionKind === 'override' ? requestedMinutes(selectedRequest) : undefined}
                                value={decisionMinutes}
                                onChange={(event) => setDecisionMinutes(Number(event.target.value))}
                              />
                            </div>
                          )}
                          <div className="space-y-1.5">
                            <Label htmlFor="decision-reason">{decisionKind === 'override' ? 'Reason for override' : `Why are you ${decisionMode === 'approve' ? 'approving' : 'rejecting'} it?`}</Label>
                            <Textarea id="decision-reason" value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} placeholder="This is kept in the decision history…" />
                          </div>
                          <div className="flex gap-2">
                            <Button variant="outline" onClick={() => { setDecisionMode(null); setDecisionReason('') }}>Cancel</Button>
                            <Button disabled={busy || !decisionReason.trim() || (decisionMode === 'approve' && decisionMinutes < 1)} onClick={() => void runDecision(decisionMode)}>
                              {busy ? 'Saving…' : decisionMode === 'approve' ? 'Approve & update estimate' : 'Reject request'}
                            </Button>
                          </div>
                        </div>
                      )}
                      {selectedRequest.decisions?.length ? (
                        <details className="px-4 text-sm">
                          <summary className="cursor-pointer text-muted-foreground">Decision history ({selectedRequest.decisions.length})</summary>
                          <div className="mt-2 space-y-2">
                            {selectedRequest.decisions.map((decision) => (
                              <div key={decision.id}>
                                <strong>{decision.source === 'ai' ? 'AI project manager' : decision.source === 'human_override' ? 'Human override' : decision.source === 'system' ? 'System' : displayName(decision.decider)}</strong>
                                <span className="ml-1 text-muted-foreground">{decision.action}{decision.action === 'approve' ? ` · ${decision.approvedAdditionalMinutes ?? decision.approved_additional_minutes ?? 0} minutes` : ''}</span>
                                <p className="text-muted-foreground">{decision.reason}</p>
                              </div>
                            ))}
                          </div>
                        </details>
                      ) : null}
                    </Card>
                  )}
                </div>
              </ScrollArea>

              {can('tasks.comment') ? (
                <div className="flex items-end gap-2 border-t p-3">
                  <Textarea
                    ref={replyRef}
                    value={replyBody}
                    disabled={busy}
                    aria-label="Reply in this conversation"
                    placeholder={`Reply to ${displayName(partner)}…  (Enter to send)`}
                    onChange={(event) => setReplyBody(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendReply() } }}
                    className="min-h-9"
                  />
                  <Button disabled={busy || !replyBody.trim()} onClick={() => void sendReply()}><Send /> {busy ? 'Sending…' : 'Send'}</Button>
                </div>
              ) : <p className="border-t p-3 text-sm text-muted-foreground">Your role can read this conversation but cannot reply.</p>}
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"><Inbox className="size-6" /></span>
              <h2 className="text-lg font-medium">Select a conversation</h2>
              <p className="max-w-sm text-sm text-muted-foreground">Pick one on the left, ask Oliver, or start a new conversation with someone.</p>
              {can('tasks.comment') && <Button onClick={() => setComposerOpen(true)}><Plus /> Start a conversation</Button>}
            </div>
          )}
        </Card>

        {/* Task context, pinned instead of hidden behind "Open task". */}
        {selected && !oliverOpen && task && (
          <aside aria-label="Task context" className="hidden min-h-0 flex-col gap-4 xl:flex xl:overflow-y-auto">
            <Card className="gap-2 py-4">
              <div className="space-y-2 px-4">
                <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Task</p>
                <strong className="block">{task.title}</strong>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {task.status_value && <StatusBadge value={task.status_value.label} />}
                  {task.due_date && (
                    <span className={cn(isOverdue(task) && 'text-destructive')}>
                      Due {new Date(task.due_date).toLocaleDateString([], { day: 'numeric', month: 'short' })}
                    </span>
                  )}
                </div>
                {task.project?.name && <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><Briefcase className="size-3.5" /> {task.project.name}</p>}
                {can('tasks.view') && <Button variant="outline" size="sm" asChild><Link to={`/tasks/${task.id}`}>Open task</Link></Button>}
              </div>
            </Card>
            <Card className="gap-2 py-4">
              <div className="space-y-2 px-4">
                <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Time</p>
                <p className="text-sm"><strong><Minutes value={loggedMinutes} /></strong> {estimateMinutes > 0 && <span className="text-muted-foreground">of <Minutes value={estimateMinutes} /> estimate</span>}</p>
                {estimateMinutes > 0 && (
                  <Progress
                    value={Math.min(100, Math.round((loggedMinutes / estimateMinutes) * 100))}
                    aria-label={`${Math.round((loggedMinutes / estimateMinutes) * 100)} percent of the estimate used`}
                  />
                )}
                {task.assignee && <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><UserRound className="size-3.5" /> {displayName(task.assignee)}</p>}
              </div>
            </Card>
            {threadFiles.length > 0 && (
              <Card className="gap-2 py-4">
                <div className="space-y-2 px-4">
                  <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Files in thread</p>
                  {attachmentList(threadFiles)}
                </div>
              </Card>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}
