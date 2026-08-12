import { useEffect, useRef, useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { LabelRow } from '@/components/kernix/label-row'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { EntityId, Subtask } from '@/types/api'

/**
 * The drawer's SUBTASKS section, split out for the same reason Files was:
 * it owns a collection with its own add affordance, so it earns its own
 * header row rather than living inline in the drawer's big JSX block.
 *
 * Toggling a subtask's completion stays the parent's job — `TasksTriagePage`
 * already owns that request and its refresh — but creating one is entirely
 * local, mirroring how `TaskDrawerFiles` owns its own uploads: the section
 * posts the new row itself and asks the parent to reload once it lands.
 */
export function TaskDrawerSubtasks({
  taskId,
  subtasks,
  canManage,
  adminOverride = false,
  onToggle,
  onCreated,
}: {
  taskId: EntityId
  subtasks: Subtask[]
  canManage: boolean
  adminOverride?: boolean
  onToggle: (subtask: Subtask) => void
  onCreated: () => void | Promise<void>
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Re-runs on `busy` too: submitting disables the input, which blurs it,
  // and the reload the parent runs afterward re-renders this section without
  // ever flipping `adding` — so a focus effect keyed on `adding` alone would
  // never fire again. Keying on both means the input gets refocused the
  // instant `busy` drops back to false and `disabled` clears, whether that's
  // the initial open or the input becoming usable again after a create.
  useEffect(() => {
    if (adding && !busy) inputRef.current?.focus()
  }, [adding, busy])

  // Same rule as Files: an empty collection nobody here can add to has
  // nothing to show, so the section is absent rather than an empty box.
  if (!canManage && subtasks.length === 0) return null

  const doneSubtasks = subtasks.filter((subtask) => Boolean(subtask.completedAt ?? subtask.completed_at)).length

  const cancel = () => {
    setAdding(false)
    setDraft('')
    setError('')
  }

  const submit = async () => {
    const title = draft.trim()
    if (!title || busy) return
    setBusy(true)
    setError('')
    try {
      await api.post(`/api/tasks/${taskId}/subtasks`, { title, admin_override: adminOverride ? 1 : undefined })
      setDraft('')
      // Stays open — adding several subtasks in a row is the common case.
      await onCreated()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That step could not be added.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex flex-col gap-[9px]">
      <div className="flex items-center gap-2.5">
        <LabelRow>Subtasks</LabelRow>
        <span className="font-mono text-[11px] text-label-fg">
          {subtasks.length > 0 ? `${doneSubtasks}/${subtasks.length}` : subtasks.length}
        </span>
        {subtasks.length > 0 ? (
          <span className="h-0.5 flex-1 overflow-hidden rounded-full bg-rail">
            <span
              className="block h-full rounded-full bg-good"
              style={{ width: `${Math.round((doneSubtasks / subtasks.length) * 100)}%` }}
            />
          </span>
        ) : (
          <span className="flex-1" />
        )}
        {canManage && !adding && (
          <button
            type="button"
            onClick={() => { setError(''); setAdding(true) }}
            className="inline-flex h-6 flex-none items-center gap-1 rounded-[7px] px-2 text-[11.5px] whitespace-nowrap text-t3 hover:bg-soft hover:text-t1"
          >
            <Plus className="size-3" />
            Add
          </button>
        )}
      </div>

      {error && <p className="text-[11px] text-destructive">{error}</p>}

      {subtasks.length > 0 && (
        <div className="-mx-2 flex flex-col">
          {subtasks.map((subtask) => {
            const subtaskDone = Boolean(subtask.completedAt ?? subtask.completed_at)
            return (
              <button
                key={String(subtask.id)}
                type="button"
                onClick={() => onToggle(subtask)}
                className="flex items-center gap-[11px] rounded-[7px] p-2 text-left hover:bg-[#16161a]"
              >
                <span
                  className={cn(
                    'grid size-4 flex-none place-items-center rounded-full border-[1.5px] text-bg',
                    subtaskDone ? 'border-good bg-good' : 'border-[#55555f]',
                  )}
                >
                  {subtaskDone && <Check className="size-2.5" strokeWidth={3.5} />}
                </span>
                <span className={cn('text-body-lg', subtaskDone ? 'text-t4 line-through' : 'text-[#a8a8b0]')}>
                  {subtask.title}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {canManage && adding && (
        <input
          ref={inputRef}
          type="text"
          value={draft}
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Stopped here so this never reaches the drawer's own window-level
            // Escape handler — cancelling the input must not also close the
            // drawer, the same problem the Files lightbox solves for itself.
            if (event.key === 'Escape') {
              event.stopPropagation()
              cancel()
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              void submit()
            }
          }}
          aria-label="New subtask title"
          placeholder="Add a step — ↵ to add"
          className="h-8 rounded-[7px] border border-line bg-transparent px-2.5 text-body-lg text-t1 outline-none placeholder:text-t4 focus:border-line-strong"
        />
      )}
    </section>
  )
}
