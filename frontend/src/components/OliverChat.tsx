import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Check, Send, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { api, unwrap } from '@/lib/api'
import type { ApiEnvelope, OliverMessage, OliverThread } from '@/types/api'

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
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b p-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">O</span>
        <div className="min-w-0 flex-1">
          <strong className="block">Oliver</strong>
          <span className="text-xs text-muted-foreground">
            {available ? 'Project manager · can create and update tasks for you' : 'Unavailable until AI is configured in Settings'}
          </span>
        </div>
        {messages.length > 0 && <Button type="button" variant="outline" size="sm" onClick={() => void clear()}>Clear</Button>}
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-4" ref={listRef}>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : messages.length === 0 ? (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p><strong className="text-foreground">Ask Oliver about the work, or tell him what to change.</strong></p>
              <ul className="list-disc space-y-1 pl-5">
                <li>“What is overdue this week?”</li>
                <li>“Add a task to book the studio on the launch film and give it to Casey.”</li>
                <li>“Push the colour grade to Friday and leave a note saying why.”</li>
              </ul>
            </div>
          ) : messages.map((message) => (
            <div key={message.id} className={cn('flex items-start gap-2', message.role === 'user' && 'flex-row-reverse')}>
              {message.role === 'assistant' && (
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">O</span>
              )}
              <div className={cn('max-w-[85%] space-y-2', message.role === 'user' && 'items-end')}>
                <p className={cn('rounded-lg px-3 py-2 text-sm', message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted')}>{message.body}</p>
                {(message.actions?.length ?? 0) > 0 && (
                  <ul className="space-y-1">
                    {message.actions!.map((action, index) => (
                      <li key={`${message.id}-${index}`} className={cn('flex items-center gap-1.5 text-xs', action.status === 'done' ? 'text-success' : 'text-destructive')}>
                        {action.status === 'done' ? <Check className="size-3.5 shrink-0" /> : <X className="size-3.5 shrink-0" />}
                        <span>{action.summary}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Skeleton className="size-2 rounded-full" /> Oliver is thinking…
            </div>
          )}
        </div>
      </ScrollArea>

      {error && <p className="border-t px-3 py-2 text-sm text-destructive" role="alert">{error}</p>}

      <form className="flex items-end gap-2 border-t p-3" onSubmit={send}>
        <Textarea
          value={body}
          disabled={busy || !available}
          aria-label="Message Oliver"
          placeholder={available ? 'Ask a question, or tell Oliver what to change…' : 'Oliver is switched off in Settings.'}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={onKeyDown}
          className="min-h-9"
        />
        <Button type="submit" disabled={busy || !available || !body.trim()}>
          <Send /> {busy ? 'Sending…' : 'Send'}
        </Button>
      </form>
    </section>
  )
}
