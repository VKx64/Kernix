import { useLayoutEffect, type RefObject } from 'react'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The reply box: one contained well holding the textarea and its own toolbar,
 * rather than a field with controls floating beside it.
 *
 * The send button is the only thing on the screen that fills, and it only
 * fills once there is something to send — an empty draft leaves it muted and
 * inert, so the box never invites a click that would do nothing.
 */
export function MessageComposer({
  value,
  busy,
  placeholder,
  inputRef,
  onChange,
  onSend,
}: {
  value: string
  busy: boolean
  placeholder: string
  inputRef: RefObject<HTMLTextAreaElement | null>
  onChange: (value: string) => void
  onSend: () => void
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
            aria-label="Mention someone"
            onClick={() => {
              onChange(`${value}${value && !value.endsWith(' ') ? ' ' : ''}@`)
              inputRef.current?.focus()
            }}
            className="grid size-7 flex-none place-items-center rounded-lg text-[14px] text-t3 hover:bg-[#1f1f26] hover:text-t1"
          >
            @
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
              ready ? 'bg-t1 text-bg hover:brightness-110' : 'bg-[#1f1f26] text-[#55555f]',
            )}
          >
            <ArrowRight className="size-[14px]" strokeWidth={1.9} />
          </button>
        </div>
      </div>
    </div>
  )
}
