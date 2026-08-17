import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { cn } from '@/lib/utils'
import { api, unwrap } from '@/lib/api'
import type { ApiEnvelope, OliverMessage, OliverThread } from '@/types/api'

/**
 * What each kind of turn is called, and the colour it wears. The design gives
 * Oliver four voices — a digest, something it did, something at risk, and
 * something waiting on you — so a thread can be skimmed for the one that
 * matters without reading it.
 */
const TAGS: Record<string, { label: string; color: string }> = {
  digest: { label: 'Standup', color: 'var(--brand)' },
  action: { label: 'Acted', color: 'var(--good)' },
  alert: { label: 'Risk', color: 'var(--danger)' },
  approval: { label: 'Needs you', color: 'var(--warn)' },
}

function kindOf(message: OliverMessage): string {
  if (message.role === 'user') return ''
  // A turn only earns the Acted badge — and the offer to undo — once something
  // in it actually happened. A message where every action was refused is Oliver
  // declining, not Oliver acting, however many attempts it made.
  if (message.actions?.some((action) => action.status === 'done')) return 'action'
  return (message as unknown as { kind?: string }).kind ?? ''
}

/**
 * One line per distinct outcome rather than one per action: a permission
 * check that refused four actions the same way reads as one sentence, not a
 * wall of identical bullets.
 */
function groupedActions(actions: OliverMessage['actions']): Array<{ status: string; summary: string; count: number }> {
  const rows: Array<{ status: string; summary: string; count: number }> = []
  for (const action of actions ?? []) {
    const existing = rows.find((row) => row.status === action.status && row.summary === action.summary)
    if (existing) existing.count += 1
    else rows.push({ status: action.status, summary: action.summary, count: 1 })
  }
  return rows
}

/**
 * The conversation with Oliver.
 *
 * Turns are flat rows rather than opposing bubbles: a thread with an assistant
 * is a record of what was asked and what was done, and alternating sides makes
 * that harder to read. What Oliver did renders as a card under its sentence,
 * with the actions attached to it.
 */
export function OliverChat({
  prompts = [],
  autopilot = true,
  hint,
  onActed,
  registerAsk,
}: {
  prompts?: string[]
  /** The autopilot switch. When off, Oliver proposes instead of acting. */
  autopilot?: boolean
  /** The line under the composer — what the current mode will and will not do. */
  hint?: string
  /** Called after a turn that changed something, so the rail can refresh. */
  onActed?: () => void
  /** Hands the parent a way to ask a question from the tools rail. */
  registerAsk?: (ask: (text: string) => void) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
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

  const ask = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || busy || !available) return
    setBusy(true)
    setError('')
    // The question appears at once; the answer lands when it lands.
    setMessages((current) => [...current, { id: `pending-${Date.now()}`, role: 'user', body: trimmed, actions: [] }])
    setBody('')
    try {
      const response = unwrap(await api.post<ApiEnvelope<{ message: OliverMessage }> | { message: OliverMessage }>('/api/oliver/messages', { body: trimmed, autopilot }))
      setMessages((current) => [...current, response.message])
      if (response.message.actions?.some((action) => action.status === 'done')) onActed?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Oliver could not reply.')
    } finally {
      setBusy(false)
    }
  }, [busy, available, autopilot, onActed])

  useEffect(() => { registerAsk?.((text) => { void ask(text) }) }, [registerAsk, ask])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void ask(body)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void ask(body)
    }
    // The page owns Escape; a draft here should not close the screen.
    if (event.key === 'Escape' && body) event.stopPropagation()
  }

  return (
    <>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-7 pb-2 pt-[18px]">
        <div className="flex flex-col gap-[18px]">
          {loading && <p className="text-body-lg text-t4">Reading your work…</p>}

          {!loading && !messages.length && (
            <p className="max-w-[62ch] text-body-lg leading-[1.6] text-t3 text-pretty">
              Ask Oliver about the work — what is late, what is unowned, whether the week
              is over-committed — or tell him what to change. He acts on your own work and
              tells you afterwards, with an undo.
            </p>
          )}

          {messages.map((message) => {
            const mine = message.role === 'user'
            const tag = TAGS[kindOf(message)]
            return (
              <div key={message.id} className="flex items-start gap-3">
                <span
                  className={cn(
                    'grid size-[26px] flex-none place-items-center rounded-[9px] font-bold text-brand-hover',
                    mine ? 'bg-brand/15 text-[9.5px]' : 'bg-brand/[0.14] text-[11px]',
                  )}
                >
                  {mine ? 'You' : 'O'}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-[7px]">
                  <div className="flex items-baseline gap-2">
                    <span className="text-body-sm font-semibold text-title">{mine ? 'You' : 'Oliver'}</span>
                    {tag && (
                      <span
                        className="inline-flex h-[17px] items-center rounded-[5px] px-[7px] text-[10px] font-semibold uppercase tracking-[0.04em]"
                        style={{ background: `color-mix(in srgb, ${tag.color} 13%, transparent)`, color: tag.color }}
                      >
                        {tag.label}
                      </span>
                    )}
                  </div>

                  {/*
                    Oliver answers in lists far more often than in prose — what is
                    late, who is free, what it just changed — and every one of those
                    arrives with real newlines. Without pre-wrap they collapse into a
                    single run-on paragraph, which is exactly the shape of answer that
                    most needs its line breaks.
                  */}
                  {message.body && (
                    <span className={cn('whitespace-pre-wrap text-body-lg leading-[1.6] text-pretty', mine ? 'text-title' : 'text-[#c8c8d0]')}>
                      {message.body}
                    </span>
                  )}

                  {(message.actions?.length ?? 0) > 0 && (() => {
                    const rows = groupedActions(message.actions)
                    const acted = rows.some((row) => row.status === 'done')
                    return (
                      <div className="flex flex-col gap-2 rounded-[11px] border border-line bg-surface px-3.5 py-[13px]">
                        {rows.map((row, index) => (
                          <span key={`${message.id}-${index}`} className="flex items-baseline gap-[9px]">
                            <span
                              aria-hidden="true"
                              className={cn('size-[5px] flex-none rounded-full', row.status === 'done' ? 'bg-good' : row.status === 'proposed' ? 'bg-warn' : 'bg-danger')}
                            />
                            <span className={cn('flex-1 text-body-sm leading-[1.5]', row.status === 'done' ? 'text-[#a8a8b0]' : row.status === 'proposed' ? 'text-warn' : 'text-danger')}>
                              {row.summary}{row.count > 1 ? ` (×${row.count})` : ''}
                            </span>
                          </span>
                        ))}
                        {/* Nothing to undo when nothing was done: the offer would be a lie. */}
                        {acted && <span className="text-meta text-t4">Undo any of these from the rail.</span>}
                      </div>
                    )
                  })()}
                </div>
              </div>
            )
          })}

          {busy && (
            <div className="flex items-start gap-3">
              <span className="grid size-[26px] flex-none place-items-center rounded-[9px] bg-brand/[0.14] text-[11px] font-bold text-brand-hover">O</span>
              <span className="inline-flex h-[26px] items-center rounded-[9px] bg-elev-low px-[11px] text-meta text-t3">thinking…</span>
            </div>
          )}
        </div>
      </div>

      {error && <p className="px-7 pb-1 text-body text-danger" role="alert">{error}</p>}

      <div className="flex-none px-7 pb-[18px] pt-1.5">
        {prompts.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pb-[9px]">
            {prompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={busy || !available}
                onClick={() => void ask(prompt)}
                className="h-[26px] whitespace-nowrap rounded-lg border border-line px-[11px] text-meta text-t2 hover:bg-soft hover:text-t1 disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </div>
        )}

        <form className="flex flex-col rounded-xl border border-line-strong bg-inset" onSubmit={submit}>
          <textarea
            ref={inputRef}
            rows={2}
            value={body}
            disabled={busy || !available}
            aria-label="Message Oliver"
            placeholder={available ? 'Ask Oliver about the work — or tell him what to change' : 'Oliver is switched off in Settings.'}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={onKeyDown}
            className="w-full resize-none border-0 bg-transparent px-[13px] pb-1 pt-[11px] text-body-lg leading-[1.5] text-t1 outline-none placeholder:text-t4"
          />
          <div className="flex items-center gap-2 py-1 pl-[13px] pr-2">
            <span className="truncate text-meta text-t5">{hint}</span>
            <span className="flex-1" />
            <button
              type="submit"
              disabled={busy || !available || !body.trim()}
              className={cn(
                'inline-flex h-[27px] items-center rounded-sm px-3 text-meta font-semibold transition-colors',
                body.trim() && !busy && available ? 'bg-t1 text-bg hover:brightness-110' : 'bg-soft text-t4',
              )}
            >
              Send
            </button>
          </div>
        </form>
      </div>
    </>
  )
}
