import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { Avatar, EmptyState, ErrorBanner, Minutes, PageHeader, StatusBadge } from '../components/ui'
import { Icon } from '../components/Icon'
import { api, displayName, unwrap } from '../lib/api'
import { useCollection } from '../lib/useCollection'
import { useCan } from '../lib/permissions'
import type { ApiEnvelope, EntityId, EstimateRequest, Message, Note } from '../types/api'

function noteDate(note?: Note | null) {
  const date = note?.createdAt ?? note?.created_at
  if (!date) return ''
  const parsed = new Date(date)
  const today = new Date()
  return parsed.toDateString() === today.toDateString()
    ? parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : parsed.toLocaleDateString([], { month: 'short', day: 'numeric' })
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

export function MessagesPage() {
  const can = useCan()
  const { user } = useAuth()
  const { messageId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const scope = searchParams.get('scope') === 'all' ? 'all' : 'unread'
  const [search, setSearch] = useState(searchParams.get('search') ?? '')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Message | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [replyBody, setReplyBody] = useState('')
  const [decisionReason, setDecisionReason] = useState('')
  const [decisionMinutes, setDecisionMinutes] = useState(0)
  const [busy, setBusy] = useState(false)
  const { data, meta, loading, error, reload } = useCollection<Message>('/api/messages', { search, page, filters: { filter: scope } })

  const openMessage = useCallback(async (id: EntityId) => {
    setDetailLoading(true)
    setDetailError('')
    try {
      const response = await api.get<ApiEnvelope<Message> | Message>(`/api/messages/${id}`)
      const message = unwrap(response)
      setSelected(message)
      const request = estimateRequest(message)
      setDecisionMinutes(request ? requestedMinutes(request) : 0)
      setDecisionReason('')
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
    if (messageId) void openMessage(messageId)
    else setSelected(null)
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

  const visibleMessages = useMemo(() => data, [data])

  const markAll = async () => {
    try {
      await api.post('/api/messages/mark-all-read')
      await reload()
      if (selected) setSelected({ ...selected, unread_count: 0 })
    } catch (reason) {
      setDetailError(reason instanceof Error ? reason.message : 'Unable to mark messages as read.')
    }
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
      await openMessage(selected.id)
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
      await openMessage(selected.id)
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
      await openMessage(selected.id)
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

  return (
    <div>
      <PageHeader eyebrow="Communication" title="Messages" description="Task conversations and estimate requests in one place." actions={<button className="btn btn-quiet" onClick={() => void markAll()}><Icon name="check" size={16} /> Mark all read</button>} />
      {detailError && <ErrorBanner message={detailError} />}
      <section className="messages-layout">
        <aside className="message-list-panel">
          <div className="message-tabs">
            {(['unread', 'all'] as const).map((value) => <button className={scope === value ? 'active' : ''} key={value} onClick={() => { setSearchParams({ scope: value }); setPage(1) }}>{value === 'unread' ? 'Unread' : 'All messages'}</button>)}
          </div>
          <label className="message-search"><Icon name="search" size={16} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search conversations…" /></label>
          {error && <ErrorBanner message={error} onRetry={() => void reload()} />}
          <div className="message-list">
            {loading ? Array.from({ length: 6 }, (_, index) => <div className="message-skeleton" key={index}><span className="skeleton circle"/><div><span className="skeleton"/><span className="skeleton short"/></div></div>) : visibleMessages.length ? visibleMessages.map((message) => {
              const latest = message.latestMessage ?? message.latest_message ?? message
              const sender = latest.author ?? message.sender ?? message.author
              const senderName = latest.actorName ?? latest.actor_name ?? displayName(sender)
              return (
                <button className={`${isUnread(message) ? 'unread' : ''} ${String(message.id) === String(messageId) ? 'active' : ''}`} key={message.id} onClick={() => navigate(`/messages/${message.id}?scope=${scope}`)}>
                  <Avatar user={sender} size={38} />
                  <div><span className="message-list-head"><strong>{senderName}</strong><time>{noteDate(latest)}</time></span><b>{message.subject || message.task?.title || 'Task message'}</b><p>{latest.body}</p></div>
                  {isUnread(message) && <span className="unread-dot" />}
                </button>
              )
            }) : <EmptyState title={scope === 'unread' ? 'You’re all caught up' : 'No conversations yet'} description={scope === 'unread' ? 'New replies and estimate requests will appear here.' : 'Task conversations will appear here.'} />}
          </div>
          {visibleMessages.length > 0 && <div className="message-list-footer"><button disabled={meta.page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {meta.page} of {meta.lastPage ?? 1}</span><button disabled={meta.page >= (meta.lastPage ?? 1)} onClick={() => setPage((value) => value + 1)}>Next</button></div>}
        </aside>
        <article className="message-detail">
          {detailLoading ? <div className="detail-loading"><span className="spinner" /> Opening conversation…</div> : selected ? (
            <>
              <header className="message-detail-header">
                <div><span className="eyebrow">{selectedRequest ? 'Estimate request' : 'Task conversation'}</span><h2>{selected.subject || selected.task?.title || 'Task message'}</h2></div>
                <div className="message-detail-actions"><button className="btn btn-quiet" onClick={() => void toggleUnread()}>{isUnread(selected) ? 'Mark read' : 'Mark unread'}</button>{selected.task && can('tasks.view') && <Link className="btn btn-primary" to={`/tasks/${selected.task.id}`}>Open task →</Link>}</div>
              </header>
              {selectedRequest && (
                <section className="estimate-request-card">
                  <div><span className="eyebrow">Additional time requested</span><strong><Minutes value={requestedMinutes(selectedRequest)} /></strong><StatusBadge value={selectedRequest.status} /></div>
                  {aiReview && <p><strong>AI project manager:</strong> {selectedAiState === 'queued' || selectedAiState === 'running' ? 'Strict review in progress…' : selectedAiState === 'waiting_employee' ? 'Waiting for the employee to answer its challenge.' : selectedAiState === 'budget_blocked' ? 'Monthly budget reached; a human manager can decide.' : selectedAiState === 'failed' ? 'Review failed; a human manager can decide.' : selectedAiState === 'overridden' ? 'The AI decision was overridden by a manager.' : selectedAiState === 'decided' ? 'Decision completed and logged.' : 'Enabled for this request.'}</p>}
                  <p>Current estimate at request: <Minutes value={selectedRequest.baseEstimatedMinutes ?? selectedRequest.base_estimated_minutes ?? 0} /></p>
                  {selectedRequest.status === 'approved' && <p>Approved increase: <Minutes value={approvedMinutes(selectedRequest)} />. The task estimate was updated immediately.</p>}
                  {selectedRequest.status === 'replaced' && <p>This request was replaced by a newer request.</p>}
                </section>
              )}
              <div className="conversation-thread">
                {(selected.messages ?? [selected]).map((message) => {
                  const mine = String(message.author?.id ?? message.createdBy ?? message.created_by) === String(user?.id)
                  const actor = message.actorName ?? message.actor_name ?? displayName(message.author)
                  const isAi = (message.actorType ?? message.actor_type) === 'ai'
                  return <article className={`${mine ? 'mine' : ''} ${isAi ? 'ai-message' : ''}`} key={message.id}><div className="conversation-author"><Avatar user={message.author} size={34} /><div><strong>{actor}</strong>{isAi && <span className="ai-actor-badge">AI</span>}<time>{noteDate(message)}</time></div></div><div className="conversation-bubble">{message.body.split('\n').map((line, index) => <p key={index}>{line || <br />}</p>)}</div></article>
                })}
              </div>
              {canReview && (
                <section className="estimate-decision-box">
                  <h3>Review request</h3>
                  <p>You may counteroffer a different increase. Approval updates the task estimate immediately.</p>
                  <label><span>Approved additional minutes</span><input type="number" min="1" value={decisionMinutes} onChange={(event) => setDecisionMinutes(Number(event.target.value))} /></label>
                  <label><span>Why are you approving or rejecting it?</span><textarea value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} placeholder="Explain the decision to the employee…" /></label>
                  <div><button className="btn btn-quiet" disabled={busy || !decisionReason.trim()} onClick={() => void decide('reject')}>Reject</button><button className="btn btn-primary" disabled={busy || decisionMinutes < 1 || !decisionReason.trim()} onClick={() => void decide('approve')}>{busy ? 'Saving…' : 'Approve & update estimate'}</button></div>
                </section>
              )}
              {canOverride && (
                <section className="estimate-decision-box ai-override-box">
                  <h3>Override AI decision</h3>
                  <p>Your reason is required and will be kept in the permanent decision history. Any estimate difference is applied immediately.</p>
                  <label><span>Approved additional minutes</span><input type="number" min="1" max={requestedMinutes(selectedRequest!)} value={decisionMinutes} onChange={(event) => setDecisionMinutes(Number(event.target.value))} /></label>
                  <label><span>Reason for override</span><textarea value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} placeholder="Explain why human judgment should replace the AI decision…" /></label>
                  <div><button className="btn btn-quiet" disabled={busy || !decisionReason.trim()} onClick={() => void overrideDecision('reject')}>Override as rejected</button><button className="btn btn-primary" disabled={busy || decisionMinutes < 1 || !decisionReason.trim()} onClick={() => void overrideDecision('approve')}>Override & apply time</button></div>
                </section>
              )}
              {selectedRequest?.decisions?.length ? <section className="estimate-history"><h3>Decision history</h3>{selectedRequest.decisions.map((decision) => <div key={decision.id}><strong>{decision.source === 'ai' ? 'AI project manager' : decision.source === 'human_override' ? 'Human override' : decision.source === 'system' ? 'System' : displayName(decision.decider)}</strong><span>{decision.action}{decision.action === 'approve' ? ` · ${decision.approvedAdditionalMinutes ?? decision.approved_additional_minutes ?? 0} minutes` : ''}</span><p>{decision.reason}</p></div>)}</section> : null}
              {can('tasks.comment') && (
                <section className="conversation-reply"><textarea value={replyBody} onChange={(event) => setReplyBody(event.target.value)} placeholder="Reply in this conversation…" /><button className="btn btn-primary" disabled={busy || !replyBody.trim()} onClick={() => void sendReply()}><Icon name="send" size={15} /> Send reply</button></section>
              )}
            </>
          ) : (
            <div className="message-placeholder"><span><Icon name="inbox" size={34} /></span><h2>Select a conversation</h2><p>Choose a task conversation to read its full history.</p></div>
          )}
        </article>
      </section>
    </div>
  )
}
