import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { Avatar, EmptyState, ErrorBanner, PageHeader } from '../components/ui'
import { Icon } from '../components/Icon'
import { api, displayName, unwrap } from '../lib/api'
import { useCollection } from '../lib/useCollection'
import { useCan } from '../lib/permissions'
import type { ApiEnvelope, EntityId, Message } from '../types/api'

function messageDate(message: Message) {
  const date = message.createdAt ?? message.created_at
  if (!date) return ''
  const parsed = new Date(date)
  const today = new Date()
  return parsed.toDateString() === today.toDateString()
    ? parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : parsed.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function isUnread(message: Message) {
  return !(message.readAt ?? message.read_at)
}

export function MessagesPage() {
  const can = useCan()
  const { messageId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const scope = searchParams.get('scope') === 'all' ? 'all' : 'unread'
  const [search, setSearch] = useState(searchParams.get('search') ?? '')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Message | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const { data, meta, loading, error, reload } = useCollection<Message>('/api/messages', { search, page, filters: { filter: scope } })

  const openMessage = useCallback(async (id: EntityId) => {
    setDetailLoading(true)
    setDetailError('')
    try {
      const response = await api.get<ApiEnvelope<Message> | Message>(`/api/messages/${id}`)
      const message = unwrap(response)
      setSelected(message)
      if (isUnread(message)) {
        await api.patch(`/api/messages/${id}/read`)
        setSelected((old) => old ? { ...old, read_at: new Date().toISOString() } : old)
        void reload()
      }
    } catch (reason) {
      setDetailError(reason instanceof Error ? reason.message : 'Unable to open this message.')
    } finally {
      setDetailLoading(false)
    }
  }, [reload])

  useEffect(() => {
    if (messageId) void openMessage(messageId)
    else setSelected(null)
  }, [messageId, openMessage])

  const visibleMessages = useMemo(() => data, [data])

  const markAll = async () => {
    try {
      await api.post('/api/messages/mark-all-read')
      await reload()
    } catch (reason) {
      setDetailError(reason instanceof Error ? reason.message : 'Unable to mark messages as read.')
    }
  }

  const toggleUnread = async () => {
    if (!selected) return
    const unread = isUnread(selected)
    await api.patch(`/api/messages/${selected.id}/${unread ? 'read' : 'unread'}`)
    setSelected({ ...selected, read_at: unread ? new Date().toISOString() : null })
    await reload()
  }

  return (
    <div>
      <PageHeader eyebrow="Communication" title="Messages" description="Task conversations assigned directly to you." actions={<button className="btn btn-quiet" onClick={() => void markAll()}><Icon name="check" size={16} /> Mark all read</button>} />
      {detailError && <ErrorBanner message={detailError} />}
      <section className="messages-layout">
        <aside className="message-list-panel">
          <div className="message-tabs">
            {(['unread', 'all'] as const).map((value) => <button className={scope === value ? 'active' : ''} key={value} onClick={() => { setSearchParams({ scope: value }); setPage(1) }}>{value === 'unread' ? 'Unread' : 'All messages'}</button>)}
          </div>
          <label className="message-search"><Icon name="search" size={16} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search messages…" /></label>
          {error && <ErrorBanner message={error} onRetry={() => void reload()} />}
          <div className="message-list">
            {loading ? Array.from({ length: 6 }, (_, index) => <div className="message-skeleton" key={index}><span className="skeleton circle"/><div><span className="skeleton"/><span className="skeleton short"/></div></div>) : visibleMessages.length ? visibleMessages.map((message) => {
              const sender = message.sender ?? message.author
              return (
                <button className={`${isUnread(message) ? 'unread' : ''} ${String(message.id) === String(messageId) ? 'active' : ''}`} key={message.id} onClick={() => navigate(`/messages/${message.id}?scope=${scope}`)}>
                  <Avatar user={sender} size={38} />
                  <div><span className="message-list-head"><strong>{displayName(sender)}</strong><time>{messageDate(message)}</time></span><b>{message.subject || message.task?.title || 'Task message'}</b><p>{message.body}</p></div>
                  {isUnread(message) && <span className="unread-dot" />}
                </button>
              )
            }) : <EmptyState title={scope === 'unread' ? 'You’re all caught up' : 'No messages yet'} description={scope === 'unread' ? 'New task messages will appear here.' : 'Messages assigned to you will appear here.'} />}
          </div>
          {visibleMessages.length > 0 && <div className="message-list-footer"><button disabled={meta.page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {meta.page} of {meta.lastPage ?? 1}</span><button disabled={meta.page >= (meta.lastPage ?? 1)} onClick={() => setPage((value) => value + 1)}>Next</button></div>}
        </aside>
        <article className="message-detail">
          {detailLoading ? <div className="detail-loading"><span className="spinner" /> Opening message…</div> : selected ? (
            <>
              <header className="message-detail-header">
                <div><span className="eyebrow">{selected.task ? 'Task conversation' : 'Message'}</span><h2>{selected.subject || selected.task?.title || 'Task message'}</h2></div>
                <div className="message-detail-actions"><button className="btn btn-quiet" onClick={() => void toggleUnread()}>{isUnread(selected) ? 'Mark read' : 'Mark unread'}</button>{selected.task && can('tasks.view') && <Link className="btn btn-primary" to={`/tasks/${selected.task.id}`}>Open task →</Link>}</div>
              </header>
              <div className="message-author"><Avatar user={selected.sender ?? selected.author} size={42} /><div><strong>{displayName(selected.sender ?? selected.author)}</strong><span>{messageDate(selected)}</span></div></div>
              <div className="message-body">{selected.body.split('\n').map((line, index) => <p key={index}>{line || <br />}</p>)}</div>
              {!!selected.attachments?.length && <div className="attachments"><span className="eyebrow">Attachments</span>{selected.attachments.map((attachment) => <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer">{attachment.originalName ?? attachment.original_name ?? attachment.name ?? 'Attachment'}</a>)}</div>}
            </>
          ) : (
            <div className="message-placeholder"><span><Icon name="inbox" size={34} /></span><h2>Select a message</h2><p>Choose a conversation to read its full context.</p></div>
          )}
        </article>
      </section>
    </div>
  )
}
