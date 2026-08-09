import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { Inbox, Plus, Search, SquareCheckBig } from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { EmptyState, ErrorBanner, Avatar } from '@/components/shared'
import { ConversationRow } from '@/components/messages/ConversationRow'
import { EstimateDecision, type DecisionMode } from '@/components/messages/EstimateDecision'
import { MessageComposer } from '@/components/messages/MessageComposer'
import { NewMessageModal } from '@/components/messages/NewMessageModal'
import { ThreadMessage } from '@/components/messages/ThreadMessage'
import {
  aiState,
  authorId,
  conversationKind,
  counterpart,
  dayLabel,
  estimateRequest,
  isOverdue,
  isUnread,
  requestedMinutes,
  reviewMode,
} from '@/components/messages/signals'
import { Tag } from '@/components/kernix/chip'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { usePageFill } from '@/layout/page-fill'
import { cn } from '@/lib/utils'
import { api, displayName, unwrap } from '@/lib/api'
import { dueMeta } from '@/lib/taskSignals'
import { useCollection } from '@/lib/useCollection'
import { useCan } from '@/lib/permissions'
import type { ApiEnvelope, EntityId, Message, Note } from '@/types/api'

/**
 * Messages — two panes.
 *
 * The left pane is the whole inbox: search, the views, and the conversations
 * under them. The right pane is one conversation from its task banner down to
 * the composer. Nothing else is on screen, and in particular there is no side
 * rail: what the rail used to carry — the task, and the time spent against its
 * estimate — has moved to the banner and to the estimate request itself, where
 * each is next to the thing it is about.
 *
 * The views are this app's own. The design splits internal from client threads,
 * which this product does not have; what it has instead is an estimate approval
 * workflow, so the filter row carries `Needs reply`, `Estimates` and the three
 * smart views rather than a team/client split.
 */

/**
 * The design's four scopes, filtering conversations by who is in them:
 * everything, colleagues, client contacts, or anything unread.
 *
 * `client` is empty by construction today — a conversation is always between
 * two workspace users, because `recipientQuery` on the server only ever
 * returns active workspace users. The tab is here rather than hidden so the
 * screen is the shape the design specifies, and so it fills itself the day
 * client threads exist rather than needing the row re-cut.
 */
type ScopeKey = 'all' | 'internal' | 'client' | 'unread'

const SCOPES: Array<{ key: ScopeKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'internal', label: 'Team' },
  { key: 'client', label: 'Clients' },
  { key: 'unread', label: 'Unread' },
]

/**
 * The estimate workflow's own routes. They are not scopes — they cut across
 * all four — so they sit under the tab row rather than in it, which is also
 * the only way to keep them without six tabs wrapping to three lines.
 */
type ViewKey = 'all' | 'estimates' | 'estimate-requests' | 'overdue' | 'assigned-to-me'

const VIEWS: Array<{ key: ViewKey; label: string }> = [
  { key: 'all', label: 'Everything' },
  { key: 'estimates', label: 'Estimates' },
  { key: 'estimate-requests', label: 'Estimate requests' },
  { key: 'overdue', label: 'Overdue tasks' },
  { key: 'assigned-to-me', label: 'Assigned to me' },
]

export function MessagesPage() {
  usePageFill()
  const can = useCan()
  const { user } = useAuth()
  const { messageId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const view = (searchParams.get('view') as ViewKey | null) ?? 'all'
  const scope = (searchParams.get('scope') as ScopeKey | null) ?? 'all'
  const [search, setSearch] = useState(searchParams.get('search') ?? '')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Message | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [replyBody, setReplyBody] = useState('')
  const [decisionReason, setDecisionReason] = useState('')
  const [decisionMinutes, setDecisionMinutes] = useState(0)
  const [decisionMode, setDecisionMode] = useState<DecisionMode | null>(null)
  const [busy, setBusy] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [newestFirst, setNewestFirst] = useState(true)
  const [cursor, setCursor] = useState(-1)
  const threadRef = useRef<HTMLDivElement>(null)
  const replyRef = useRef<HTMLTextAreaElement>(null)
  const loadedIdRef = useRef('')
  // Every view is counted, so the list is fetched whole and sorted here.
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
      case 'estimates': return Boolean(request)
      case 'estimate-requests': return request?.status === 'pending'
      case 'overdue': return isOverdue(message.task)
      case 'assigned-to-me': return String(message.task?.assignee?.id ?? '') === String(user?.id ?? '')
      default: return true
    }
  }, [user?.id])

  // `all` passes everything; `unread` is the one scope about state rather than
  // participants; the rest compare the conversation's kind, exactly as the
  // design's own filter does.
  const matchesScope = useCallback((message: Message, key: ScopeKey) => {
    if (key === 'all') return true
    if (key === 'unread') return isUnread(message)
    return conversationKind(message) === key
  }, [])

  const scopeCounts = useMemo(
    () => Object.fromEntries(SCOPES.map(({ key }) => [
      key,
      data.filter((message) => matchesScope(message, key) && matchesView(message, view)).length,
    ])) as Record<ScopeKey, number>,
    [data, matchesScope, matchesView, view],
  )

  const counts = useMemo(
    () => Object.fromEntries(VIEWS.map(({ key }) => [
      key,
      data.filter((message) => matchesView(message, key) && matchesScope(message, scope)).length,
    ])) as Record<ViewKey, number>,
    [data, matchesView, matchesScope, scope],
  )

  const visibleMessages = useMemo(() => {
    const rows = data.filter((message) => matchesView(message, view) && matchesScope(message, scope))
    const stamp = (message: Message) => new Date((message.latestMessage ?? message.latest_message ?? message)?.createdAt ?? (message.latestMessage ?? message.latest_message ?? message)?.created_at ?? 0).getTime()
    return [...rows].sort((a, b) => (newestFirst ? stamp(b) - stamp(a) : stamp(a) - stamp(b)))
  }, [data, matchesView, matchesScope, view, scope, newestFirst])

  // What wants an answer floats to the top of whichever view is on, so the
  // list is useful before any filter is touched.
  const orderedRows = useMemo(
    () => [...visibleMessages].sort((a, b) => Number(isUnread(b)) - Number(isUnread(a))),
    [visibleMessages],
  )

  useEffect(() => {
    const thread = threadRef.current
    if (thread) thread.scrollTop = thread.scrollHeight
  }, [selected])

  useEffect(() => { setPicked(new Set()) }, [view])

  const setView = (next: ViewKey) => {
    const params = new URLSearchParams(searchParams)
    if (next === 'all') params.delete('view')
    else params.set('view', next)
    setSearchParams(params)
    setPage(1)
  }

  const setScope = (next: ScopeKey) => {
    const params = new URLSearchParams(searchParams)
    if (next === 'all') params.delete('scope')
    else params.set('scope', next)
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

  const decide = async (decision: DecisionMode) => {
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

  const overrideDecision = async (decision: DecisionMode) => {
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
  const task = selected?.task
  const taskDue = dueMeta(task?.due_date)
  const aiStatusLine = selectedAiState === 'queued' || selectedAiState === 'running' ? 'Strict review in progress…'
    : selectedAiState === 'waiting_employee' ? 'Waiting for the employee to answer its challenge.'
      : selectedAiState === 'budget_blocked' ? 'Monthly budget reached; a human manager can decide.'
        : selectedAiState === 'failed' ? 'Review failed; a human manager can decide.'
          : selectedAiState === 'overridden' ? 'The AI decision was overridden by a manager.'
            : selectedAiState === 'decided' ? 'Decision completed and logged.' : 'Enabled for this request.'
  const runDecision = decisionKind === 'override' ? overrideDecision : decide

  // The delivery line only belongs under the last thing you said; anything
  // earlier has already been answered.
  const lastOwnIndex = threadMessages.reduce(
    (found, message, index) => (authorId(message) === String(user?.id ?? '') ? index : found),
    -1,
  )

  const seenLine = (message: Note, index: number) => {
    if (index !== lastOwnIndex) return ''
    const reader = message.assignedUser ?? message.assigned_user
    if (!(message.readAt ?? message.read_at)) return 'Sent'
    return reader ? `Seen by ${displayName(reader)}` : 'Seen'
  }

  const copyMessage = (body: string) => {
    void navigator.clipboard?.writeText(body).catch(() => setDetailError('That message could not be copied.'))
  }

  return (
    <>
      <div className="-mx-4 -mt-4 -mb-14 flex min-h-0 flex-1 md:-mx-7 md:-mt-[18px]">
        <div className="flex w-[292px] flex-none flex-col border-r border-line-soft">
          <div className="flex-none px-3.5 pt-[18px] pb-2.5">
            <div className="mb-3 flex items-center gap-2.5">
              <h1 className="flex-1 text-h1 text-title-strong">Messages</h1>
              {can('tasks.comment') && (
                <button
                  type="button"
                  aria-label="New message"
                  onClick={() => setComposerOpen(true)}
                  className="grid size-[27px] place-items-center rounded-[7px] bg-soft text-t2 hover:bg-[#22222a] hover:text-t1"
                >
                  <Plus className="size-3" strokeWidth={2.2} />
                </button>
              )}
            </div>

            <label className="mb-2.5 flex h-[30px] items-center gap-2 rounded-lg bg-row-hover px-[9px]">
              <Search className="size-[13px] flex-none text-label-fg" />
              <input
                value={search}
                onChange={(event) => { setSearch(event.target.value); setPage(1) }}
                placeholder="Search messages"
                aria-label="Search conversations"
                className="min-w-0 flex-1 border-0 bg-transparent text-body-sm text-t1 outline-none placeholder:text-t4"
              />
            </label>

            <nav aria-label="Conversation scope" className="flex gap-0.5">
              {SCOPES.map((item) => {
                const active = scope === item.key
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setScope(item.key)}
                    className={cn(
                      'inline-flex h-[26px] items-center gap-1.5 rounded-[7px] px-2.5 text-meta transition-colors',
                      active ? 'bg-[#26262c] font-semibold text-t1' : 'font-[450] text-t3 hover:text-t1',
                    )}
                  >
                    {item.label}
                    {scopeCounts[item.key] > 0 && (
                      <span className={cn('font-mono text-[10.5px]', active ? 'text-t2' : 'text-t4')}>
                        {scopeCounts[item.key]}
                      </span>
                    )}
                  </button>
                )
              })}
            </nav>

            {/* The estimate workflow's routes cut across all four scopes, so
                they are a filter under the tabs rather than more tabs. */}
            <label className="mt-2 flex items-center gap-2 text-meta text-t4">
              <span className="sr-only">Filter conversations</span>
              <select
                value={view}
                onChange={(event) => setView(event.target.value as ViewKey)}
                className="h-[26px] min-w-0 flex-1 rounded-[7px] bg-row-hover px-2 text-meta text-t2 outline-none"
              >
                {VIEWS.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}{counts[item.key] ? ` · ${counts[item.key]}` : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* The design's list has no control row, so this one earns its place
              only when there is something to act on: a selection to clear, or
              unread to clear in bulk. A quiet inbox shows nothing here. */}
          {(picked.size > 0 || scopeCounts.unread > 0) && (
            <div className="flex flex-none items-center gap-2 px-4 pb-1.5 text-meta text-t3">
              <Checkbox
                aria-label="Select all conversations"
                checked={visibleMessages.length > 0 && picked.size === visibleMessages.length}
                onCheckedChange={(checked) => setPicked(checked ? new Set(visibleMessages.map((message) => String(message.id))) : new Set())}
              />
              <span className="flex-1 truncate">
                {picked.size ? `${picked.size} selected` : `${scopeCounts.unread} unread`}
              </span>
              {picked.size > 0 ? (
                <ListAction disabled={busy} onClick={() => void markPickedRead()}>Read</ListAction>
              ) : (
                <>
                  <ListAction onClick={() => setNewestFirst((current) => !current)}>{newestFirst ? 'Newest' : 'Oldest'}</ListAction>
                  <ListAction onClick={() => void markAll()}>Mark all read</ListAction>
                </>
              )}
            </div>
          )}

          {error && <div className="px-3 pb-2"><ErrorBanner message={error} onRetry={() => void reload()} /></div>}

          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
            {/* Oliver used to sit at the top of this list. It is its own place
                in the nav now, as the design has it. */}
            {loading ? (
              <div className="flex flex-col gap-3 p-2.5">
                {Array.from({ length: 6 }, (_, index) => (
                  <div key={index} className="flex items-center gap-2.5">
                    <Skeleton className="size-[30px] flex-none rounded-full" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3 w-2/3" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : orderedRows.length ? orderedRows.map((message, index) => (
              <ConversationRow
                key={message.id}
                message={message}
                userId={user?.id}
                open={String(message.id) === String(messageId)}
                cursor={cursor === index}
                picked={picked.has(String(message.id))}
                onOpen={() => openRow(message)}
                onPickedChange={(next) => setPicked((current) => {
                  const updated = new Set(current)
                  if (next) updated.add(String(message.id))
                  else updated.delete(String(message.id))
                  return updated
                })}
              />
            )) : (
              <div className="px-1 pt-6">
                <EmptyState
                  icon={Inbox}
                  title={scope === 'unread' ? 'You’re all caught up' : scope === 'client' ? 'No client conversations' : 'Nothing in this view'}
                  description={scope === 'unread'
                    ? 'New replies and estimate requests land here.'
                    : scope === 'client'
                      // Said plainly: this is not an empty inbox, it is a
                      // capability that does not exist yet.
                      ? 'Conversations with client contacts will appear here once client threads are connected.'
                      : 'Try another scope, or start a conversation.'}
                />
              </div>
            )}
          </div>

          {(meta.lastPage ?? 1) > 1 && (
            <div className="flex flex-none items-center justify-between border-t border-line-soft px-3 py-2 text-meta text-t3">
              <ListAction disabled={meta.page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</ListAction>
              <span>Page {meta.page} of {meta.lastPage ?? 1}</span>
              <ListAction disabled={meta.page >= (meta.lastPage ?? 1)} onClick={() => setPage((value) => value + 1)}>Next</ListAction>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {detailLoading ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-body-sm text-t3">
              <Skeleton className="size-4 rounded-full" /> Opening conversation…
            </div>
          ) : selected ? (
            <>
              <header className="flex flex-none items-center gap-3 border-b border-line-soft px-5 py-3.5">
                <Avatar user={partner} className="size-[30px]" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="truncate text-[15px] font-semibold tracking-[-0.016em] text-title-strong">{displayName(partner)}</span>
                    <Tag>{selectedRequest ? 'Estimate' : 'Task'}</Tag>
                  </div>
                  <span className="text-meta-sm text-t3">{task?.project?.name || 'Task conversation'}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void toggleUnread()}
                  className="h-[26px] rounded-[7px] px-2.5 text-meta text-t3 hover:bg-sidebar-accent hover:text-t1"
                >
                  {isUnread(selected) ? 'Mark read' : 'Mark unread'}
                </button>
              </header>

              {task && (
                can('tasks.view') ? (
                  <Link
                    to={`/tasks/${task.id}`}
                    aria-label={task.title}
                    className="flex flex-none items-center gap-[9px] border-b border-line-soft bg-inset px-5 py-[9px] hover:bg-[#16161a]"
                  >
                    <TaskBannerBody title={task.title} due={taskDue.label} dueClassName={taskDue.className} hasDue={Boolean(task.due_date)} />
                    <span className="flex-none text-meta-sm text-label-fg">Open task</span>
                  </Link>
                ) : (
                  <div className="flex flex-none items-center gap-[9px] border-b border-line-soft bg-inset px-5 py-[9px]">
                    <TaskBannerBody title={task.title} due={taskDue.label} dueClassName={taskDue.className} hasDue={Boolean(task.due_date)} />
                  </div>
                )
              )}

              {detailError && <div className="px-5 pt-3"><ErrorBanner message={detailError} /></div>}

              <div ref={threadRef} className="min-h-0 flex-1 overflow-y-auto px-5 pt-2 pb-5">
                {threadMessages.map((message, index) => {
                  const mine = authorId(message) === String(user?.id ?? '')
                  const actor = message.actorName ?? message.actor_name ?? displayName(message.author)
                  const isAi = (message.actorType ?? message.actor_type) === 'ai'
                  const isSystem = (message.actorType ?? message.actor_type) === 'system'
                  const previous = threadMessages[index - 1]
                  const newDay = dayLabel(message) !== dayLabel(previous)
                  const grouped = !newDay && Boolean(previous) && authorId(previous) === authorId(message)
                    && (previous.actorType ?? previous.actor_type) === (message.actorType ?? message.actor_type)
                  return (
                    <div key={message.id}>
                      {newDay && (
                        <div className="my-3 flex items-center gap-2 text-meta-sm text-t4">
                          <span className="h-px flex-1 bg-line-soft" />
                          <span>{dayLabel(message)}</span>
                          <span className="h-px flex-1 bg-line-soft" />
                        </div>
                      )}
                      {isSystem ? (
                        <p className="py-1.5 text-center text-meta text-t4">{message.body}</p>
                      ) : (
                        <ThreadMessage
                          message={message}
                          mine={mine}
                          actor={actor}
                          isAi={isAi}
                          grouped={grouped}
                          seen={seenLine(message, index)}
                          onReply={() => replyRef.current?.focus()}
                          onCopy={() => copyMessage(message.body)}
                        />
                      )}
                    </div>
                  )
                })}

                {selectedRequest && (
                  <EstimateDecision
                    request={selectedRequest}
                    aiReview={aiReview}
                    aiStatusLine={aiStatusLine}
                    kind={decisionKind}
                    mode={decisionMode}
                    minutes={decisionMinutes}
                    reason={decisionReason}
                    busy={busy}
                    loggedMinutes={Number(task?.actual_minutes ?? 0)}
                    estimateMinutes={Number(task?.estimated_minutes ?? 0)}
                    onMode={setDecisionMode}
                    onMinutes={setDecisionMinutes}
                    onReason={setDecisionReason}
                    onSubmit={(mode) => void runDecision(mode)}
                  />
                )}
              </div>

              {can('tasks.comment') ? (
                <MessageComposer
                  value={replyBody}
                  busy={busy}
                  placeholder="Write a message…"
                  inputRef={replyRef}
                  onChange={setReplyBody}
                  onSend={() => void sendReply()}
                />
              ) : (
                <p className="flex-none border-t border-line-soft px-5 py-3 text-body-sm text-t3">
                  Your role can read this conversation but cannot reply.
                </p>
              )}
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState
                icon={Inbox}
                title="Select a conversation"
                description="Pick one on the left, ask Oliver, or start a new conversation with someone."
                action={can('tasks.comment')
                  ? <Button onClick={() => setComposerOpen(true)}><Plus /> Start a conversation</Button>
                  : undefined}
              />
            </div>
          )}
        </div>
      </div>

      <NewMessageModal
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        onStarted={async (conversation) => { setComposerOpen(false); await reload(); navigate(`/messages/${conversation.id}?view=all`) }}
      />
    </>
  )
}

function TaskBannerBody({ title, due, dueClassName, hasDue }: { title: string; due: string; dueClassName: string; hasDue: boolean }) {
  return (
    <>
      <SquareCheckBig className="size-[13px] flex-none text-label-fg" />
      <span className="flex-1 truncate text-body-sm text-t2">{title}</span>
      {hasDue && <span className={cn('flex-none font-mono text-meta-sm', dueClassName)}>{due}</span>}
    </>
  )
}

/** The quiet text buttons that sit around the conversation list. */
function ListAction({ children, disabled, onClick }: { children: React.ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-[22px] rounded-sm px-1.5 text-meta text-t3 hover:bg-line-soft hover:text-t1 disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  )
}
