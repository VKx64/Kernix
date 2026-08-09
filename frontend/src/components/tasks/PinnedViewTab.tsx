import { ChevronDown } from 'lucide-react'
import { type MouseEvent } from 'react'
import { cn } from '@/lib/utils'

/**
 * The saved-views tab, sitting after the five view tabs it is a peer of.
 *
 * It reads as a tab because a saved view replaces the view you were on, and it
 * carries a dot only while one is active — that dot is how you tell "Triage
 * plus filters I typed" from "the view I named".
 */
export function PinnedViewTab({
  label,
  active,
  onOpen,
}: {
  /** The active saved view's name, or the resting label. */
  label: string
  active: boolean
  onOpen: (anchor: HTMLElement) => void
}) {
  return (
    <button
      type="button"
      aria-haspopup="menu"
      onClick={(event: MouseEvent<HTMLButtonElement>) => onOpen(event.currentTarget)}
      className={cn(
        '-mb-px inline-flex h-8 items-center gap-1.5 border-b-2 px-2.5 text-body transition-colors',
        active ? 'border-t1 font-semibold text-t1' : 'border-transparent font-[450] text-t3 hover:text-t1',
      )}
    >
      {active && <span aria-hidden="true" className="size-[5px] flex-none rounded-full bg-brand" />}
      {label}
      <ChevronDown aria-hidden="true" className="size-[9px] flex-none" strokeWidth={2.2} />
    </button>
  )
}
