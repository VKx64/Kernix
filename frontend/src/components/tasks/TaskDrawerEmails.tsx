import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { LabelRow } from '@/components/kernix/label-row'
import { api } from '@/lib/api'
import type { EntityId, Note } from '@/types/api'

/** What the API adds to a note when that note is a captured email. */
type TaskEmail = Note & {
  subject?: string
  to_addresses?: string
  toAddresses?: string
  sent_at?: string
  sentAt?: string
  status?: string
}

/**
 * The drawer's EMAILS section. Correspondence was the last thing on a task
 * that could only be read on the full page, which meant the one surface most
 * likely to be checked mid-triage — what has the client already been told —
 * was the one that cost a navigation.
 *
 * Sending owns its own request the way Files and Subtasks do, and asks the
 * parent to reload once the email lands so the drawer's feed picks it up.
 */
export function TaskDrawerEmails({
  taskId,
  emails,
  canManage,
  readOnly = false,
  adminOverride = false,
  onChanged,
}: {
  taskId: EntityId
  emails: Note[]
  canManage: boolean
  /** An archived task keeps its history readable but takes no new mail. */
  readOnly?: boolean
  adminOverride?: boolean
  onChanged: () => void | Promise<void>
}) {
  const [composing, setComposing] = useState(false)
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toRef = useRef<HTMLInputElement>(null)

  // Same reasoning as the subtask input: submitting disables the field, which
  // blurs it, and the parent's reload re-renders without flipping `composing`.
  useEffect(() => {
    if (composing && !busy) toRef.current?.focus()
  }, [composing, busy])

  const rows = emails as TaskEmail[]
  const writable = canManage && !readOnly

  // An empty collection nobody here can add to has nothing to show.
  if (!writable && rows.length === 0) return null

  const cancel = () => {
    setComposing(false)
    setTo('')
    setSubject('')
    setBody('')
    setError('')
  }

  const send = async () => {
    const recipient = to.trim()
    const line = subject.trim()
    const message = body.trim()
    if (!recipient || !line || !message || busy) return
    setBusy(true)
    setError('')
    try {
      await api.post(`/api/tasks/${taskId}/emails`, {
        to_addresses: recipient,
        subject: line,
        body: message,
        admin_override: adminOverride ? 1 : undefined,
      })
      cancel()
      await onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That email could not be sent.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (email: TaskEmail) => {
    if (busy) return
    if (!window.confirm('Delete this captured email?')) return
    setBusy(true)
    setError('')
    try {
      await api.delete(`/api/tasks/${taskId}/emails/${email.id}`, {
        admin_override: adminOverride ? 1 : undefined,
      })
      await onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That email could not be deleted.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex flex-col gap-[9px]">
      <div className="flex items-center gap-2.5">
        <LabelRow>Emails</LabelRow>
        <span className="font-mono text-[11px] text-label-fg">{rows.length}</span>
        <span className="flex-1" />
        {writable && !composing && (
          <button
            type="button"
            onClick={() => { setError(''); setComposing(true) }}
            className="inline-flex h-6 flex-none items-center gap-1 rounded-[7px] px-2 text-[11.5px] whitespace-nowrap text-t3 hover:bg-soft hover:text-t1"
          >
            <Plus className="size-3" />
            Write
          </button>
        )}
      </div>

      {error && <p className="text-[11px] text-destructive">{error}</p>}

      {rows.length > 0 && (
        <div className="flex flex-col gap-2">
          {rows.map((email) => {
            const when = email.sentAt ?? email.sent_at ?? email.createdAt ?? email.created_at
            return (
              <article key={String(email.id)} className="flex flex-col gap-1 rounded-[7px] border border-line-soft p-2.5">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-body font-[550] text-[#d4d4d9]">{email.subject || 'Task email'}</span>
                  <span className="text-meta-sm text-t4">{when ? new Date(when).toLocaleString() : '—'}</span>
                  <span className="text-meta-sm text-t4">{email.status || 'sent'}</span>
                  {writable && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void remove(email)}
                      className="ml-auto text-meta-sm text-t4 hover:text-destructive"
                    >
                      Delete
                    </button>
                  )}
                </div>
                <span className="text-meta text-t3">To: {email.toAddresses || email.to_addresses || 'Recipient hidden'}</span>
                <p className="text-body-lg leading-[1.6] text-[#c8c8d0] text-pretty">{email.body}</p>
              </article>
            )
          })}
        </div>
      )}

      {writable && composing && (
        <div
          className="flex flex-col gap-1.5"
          onKeyDown={(event) => {
            // Kept off the drawer's window-level Escape handler: cancelling the
            // draft must not also close the drawer.
            if (event.key === 'Escape') {
              event.stopPropagation()
              cancel()
            }
          }}
        >
          <input
            ref={toRef}
            type="email"
            value={to}
            disabled={busy}
            onChange={(event) => setTo(event.target.value)}
            aria-label="To"
            placeholder="To — client@example.com"
            className="h-8 rounded-[7px] border border-line bg-transparent px-2.5 text-body-lg text-t1 outline-none placeholder:text-t4 focus:border-line-strong"
          />
          <input
            type="text"
            value={subject}
            disabled={busy}
            onChange={(event) => setSubject(event.target.value)}
            aria-label="Subject"
            placeholder="Subject"
            className="h-8 rounded-[7px] border border-line bg-transparent px-2.5 text-body-lg text-t1 outline-none placeholder:text-t4 focus:border-line-strong"
          />
          <textarea
            value={body}
            disabled={busy}
            onChange={(event) => setBody(event.target.value)}
            rows={4}
            aria-label="Message"
            placeholder="Write the email…"
            className="resize-none rounded-[7px] border border-line bg-transparent px-2.5 py-1.5 text-body-lg leading-[1.5] text-t1 outline-none placeholder:text-t4 focus:border-line-strong"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy || !to.trim() || !subject.trim() || !body.trim()}
              onClick={() => void send()}
              className="h-7 rounded-[7px] bg-soft px-2.5 text-[11.5px] text-t1 disabled:opacity-40 hover:bg-line-soft"
            >
              Send email
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={cancel}
              className="h-7 rounded-[7px] px-2.5 text-[11.5px] text-t3 hover:bg-soft hover:text-t1"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
