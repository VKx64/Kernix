import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Icon } from './Icon'
import { api, unwrap } from '../lib/api'
import type { ApiEnvelope, OliverMessage, OliverThread } from '../types/api'

export function OliverChat() {
  const listRef = useRef<HTMLDivElement>(null)
  const [messages, setMessages] = useState<OliverMessage[]>([])
  const [available, setAvailable] = useState(true)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const thread = unwrap(await api.get<ApiEnvelope<OliverThread> | OliverThread>('/api/oliver'))
      setMessages(Array.isArray(thread.messages) ? thread.messages : [])
      setAvailable(thread.available !== false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Oliver could not be reached.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages, busy])

  const send = async (event: FormEvent) => {
    event.preventDefault()
    const text = body.trim()
    if (!text || busy) return
    setBusy(true)
    setError('')
    // Show the teammate's line immediately; the reply lands when it lands.
    setMessages((current) => [...current, { id: `pending-${Date.now()}`, role: 'user', body: text, actions: [] }])
    setBody('')
    try {
      const response = unwrap(await api.post<ApiEnvelope<{ message: OliverMessage }> | { message: OliverMessage }>('/api/oliver/messages', { body: text }))
      setMessages((current) => [...current, response.message])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Oliver could not reply.')
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    if (!window.confirm('Clear this conversation with Oliver?')) return
    await api.delete('/api/oliver/messages')
    setMessages([])
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send(event as unknown as FormEvent)
    }
  }

  return (
    <section className="oliver-chat">
      <header className="oliver-head">
        <span className="oliver-avatar">O</span>
        <div>
          <strong>Oliver</strong>
          <small>{available ? 'Project manager · can create and update tasks for you' : 'Unavailable until AI is configured in Settings'}</small>
        </div>
        {messages.length > 0 && <button type="button" className="btn btn-quiet" onClick={() => void clear()}>Clear</button>}
      </header>

      <div className="oliver-thread" ref={listRef}>
        {loading ? (
          <p className="oliver-empty">Loading…</p>
        ) : messages.length === 0 ? (
          <div className="oliver-empty">
            <p><strong>Ask Oliver about the work, or tell him what to change.</strong></p>
            <ul>
              <li>“What is overdue this week?”</li>
              <li>“Add a task to book the studio on the launch film and give it to Casey.”</li>
              <li>“Push the colour grade to Friday and leave a note saying why.”</li>
            </ul>
          </div>
        ) : messages.map((message) => (
          <article key={message.id} className={`oliver-message is-${message.role}`}>
            {message.role === 'assistant' && <span className="oliver-avatar sm">O</span>}
            <div>
              <p>{message.body}</p>
              {(message.actions?.length ?? 0) > 0 && (
                <ul className="oliver-actions">
                  {message.actions!.map((action, index) => (
                    <li key={`${message.id}-${index}`} className={action.status === 'done' ? 'is-done' : 'is-refused'}>
                      <Icon name={action.status === 'done' ? 'check' : 'close'} size={13} />
                      <span>{action.summary}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </article>
        ))}
        {busy && <p className="oliver-typing">Oliver is thinking…</p>}
      </div>

      {error && <div className="form-error" role="alert">{error}</div>}

      <form className="oliver-composer" onSubmit={send}>
        <textarea
          value={body}
          disabled={busy || !available}
          aria-label="Message Oliver"
          placeholder={available ? 'Ask a question, or tell Oliver what to change…' : 'Oliver is switched off in Settings.'}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !available || !body.trim()}>
          <Icon name="send" size={15} /> {busy ? 'Sending…' : 'Send'}
        </button>
      </form>
    </section>
  )
}
