import { useLayoutEffect, type RefObject } from 'react'
import { ArrowRight, Paperclip, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The reply box: one contained well holding the textarea and its own toolbar,
 * rather than a field with controls floating beside it.
 *
 * The send button is the design's one brand-filled control on the screen —
 * everywhere else brand is reserved for AI and links, but the design spends
 * it here too — and it only fills once there is something to send: an empty
 * draft leaves it muted and inert, so the box never invites a click that
 * would do nothing.
 */
export function MessageComposer({
  value,
  busy,
  placeholder,
  inputRef,
  draftBusy,
  onChange,
  onSend,
  onDraftReply,
}: {
  value: string
  busy: boolean
  placeholder: string
  inputRef: RefObject<HTMLTextAreaElement | null>
  /** True while `Draft reply` is running — the chip goes inert and relabels. */
  draftBusy: boolean
  onChange: (value: string) => void
  onSend: () => void
  onDraftReply: () => void
}) {
  const ready = value.trim().length > 0 && !busy

  // Grow with the draft, between the design's 42px and 150px. Measured after
  // every change because the height has to be reset before scrollHeight means
  // anything.
  useLayoutEffect(() => {
    const field = inputRef.current
    if (!field) return
    field.style.height = 'auto'
    field.style.height = `${Math.min(150, Math.max(42, field.scrollHeight))}px`
  }, [value, inputRef])

  return (
    <div className="flex-none px-5 pt-2.5 pb-4">
      <div className="overflow-hidden rounded-[13px] border border-line-strong bg-inset">
        <textarea
          ref={inputRef}
          value={value}
          disabled={busy}
          rows={1}
          aria-label="Reply in this conversation"
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && value) {
              event.stopPropagation()
              event.currentTarget.blur()
              return
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              onSend()
            }
          }}
          className="block max-h-[150px] min-h-[42px] w-full resize-none border-0 bg-transparent px-[15px] pt-[13px] pb-1.5 text-body-lg leading-[1.55] text-t1 outline-none placeholder:text-t4"
        />

        <div className="flex items-center gap-1 py-1.5 pr-[7px] pl-[9px]">
          <button
            type="button"
            aria-label="Attach a file"
            title="Attachments aren't available yet."
            disabled
            className="grid size-7 flex-none place-items-center rounded-lg text-t3 disabled:pointer-events-none disabled:opacity-50"
          >
            <Paperclip className="size-[15px]" strokeWidth={1.6} />
          </button>
          <button
            type="button"
            aria-label="Mention someone"
            onClick={() => {
              onChange(`${value}${value && !value.endsWith(' ') ? ' ' : ''}@`)
              inputRef.current?.focus()
            }}
            className="grid size-7 flex-none place-items-center rounded-lg text-[14px] text-t3 hover:bg-[#1f1f26] hover:text-t1"
          >
            @
          </button>
          <button
            type="button"
            disabled={draftBusy}
            onClick={onDraftReply}
            className="inline-flex h-7 flex-none items-center gap-[7px] rounded-lg px-2.5 text-xs font-[550] text-[#8f92d8] hover:bg-[#1f1f26] hover:text-[#c8caff] disabled:pointer-events-none disabled:opacity-60"
          >
            <Sparkles className="size-3" strokeWidth={1.6} />
            {draftBusy ? 'Drafting…' : 'Draft reply'}
          </button>

          <span className="flex-1" />

          {ready && <span className="mr-1.5 font-mono text-[10.5px] text-[#55555f]">↵ to send</span>}

          <button
            type="button"
            aria-label="Send reply"
            disabled={!ready}
            onClick={onSend}
            className={cn(
              'grid size-[29px] flex-none place-items-center rounded-[9px] transition-colors',
              ready ? 'bg-brand text-bg hover:brightness-110' : 'bg-[#1f1f26] text-[#55555f]',
            )}
          >
            <ArrowRight className="size-[14px]" strokeWidth={1.9} />
          </button>
        </div>
      </div>
    </div>
  )
}
