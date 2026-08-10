import { useEffect, useState, type ReactNode } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

/**
 * The anchored menu every inline change goes through. Status, assignee, due
 * date, urgency, grouping, sorting and the row's own actions are all this
 * component — the design reserves modals for creation, so nothing else opens
 * one.
 *
 * Rows stay unaware of what a menu contains: a row reports which control was
 * pressed and hands over the element it was pressed on, and the page opens the
 * matching menu against that element. The trigger below is an empty box parked
 * on the anchor's rect, which is what lets a row do that while Radix still
 * owns focus, arrow-key movement and Escape.
 */
export interface InlineMenuItem {
  key: string
  label: string
  /** Rendered as a 7px dot before the label — a status or person colour. */
  color?: string | null
  /** Right-aligned, mono: a shortcut, a resolved date, a `✓`, or `›`. */
  hint?: string
  danger?: boolean
  /** A separator is drawn above this item. */
  separated?: boolean
  /**
   * Keeps the menu open on select. Needed by every `›` item that swaps this
   * menu for a deeper one — Radix closes a dropdown on select by default, which
   * would dismiss the menu instead of drilling into it.
   */
  keepOpen?: boolean
  onSelect: () => void
}

export interface InlineMenuState {
  /** Distinguishes which menu is open; also remounts content when it changes. */
  kind: string
  anchor: HTMLElement
}

export function InlineMenu({
  state,
  title,
  items,
  onClose,
  children,
}: {
  state: InlineMenuState | null
  title?: string
  items: InlineMenuItem[]
  onClose: () => void
  /** Replaces the item list entirely, for a menu that is not a list of choices. */
  children?: ReactNode
}) {
  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    if (!state) {
      setRect(null)
      return
    }
    setRect(state.anchor.getBoundingClientRect())
  }, [state])

  if (!state || !rect) return null

  return (
    <DropdownMenu open onOpenChange={(open) => { if (!open) onClose() }}>
      <DropdownMenuTrigger
        aria-hidden="true"
        tabIndex={-1}
        className="pointer-events-none fixed"
        style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
      />
      {/*
       * The menu is portalled to the body, so it competes on z-index with
       * whatever opened it. It has to outrank the overlays it can be opened
       * from — a menu anchored inside the creation modal renders behind it
       * otherwise.
       */}
      <DropdownMenuContent align="start" sideOffset={4} className="z-[80] min-w-[212px] p-[5px]">
        {title && <DropdownMenuLabel className="px-2.5 pt-[7px] pb-[5px] text-label uppercase text-label-fg">{title}</DropdownMenuLabel>}
        {children}
        {items.map((item) => (
          <div key={item.key}>
            {item.separated && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onSelect={(event) => {
                if (item.keepOpen) event.preventDefault()
                item.onSelect()
              }}
              className={cn(
                'h-[30px] gap-2.5 rounded-sm px-2.5 text-body-sm text-[#d4d4d9]',
                item.danger && 'text-danger focus:text-danger',
              )}
            >
              {item.color && (
                <span aria-hidden="true" className="size-[7px] flex-none rounded-full" style={{ background: item.color }} />
              )}
              <span className="flex-1 truncate text-left">{item.label}</span>
              {item.hint && <span className="font-mono text-[10.5px] text-t4">{item.hint}</span>}
            </DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
