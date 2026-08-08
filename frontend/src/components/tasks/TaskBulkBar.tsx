import type { MouseEvent } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The floating bar that appears once rows are selected. It carries the same
 * four menus a single row does, so a bulk change is the same gesture as a
 * single one, plus Archive — the only destructive action in the list, and the
 * only one tinted.
 */
export interface TaskBulkAction {
  key: string
  label: string
  danger?: boolean
  onSelect: (anchor: HTMLElement) => void
}

export function TaskBulkBar({
  count,
  actions,
  onClear,
}: {
  count: number
  actions: TaskBulkAction[]
  onClear: () => void
}) {
  if (!count) return null

  return (
    <div
      role="toolbar"
      aria-label={`${count} selected`}
      className="fixed bottom-6 left-1/2 z-[35] flex -translate-x-1/2 animate-in items-center gap-[3px] rounded-xl border border-line-strong bg-elev py-1.5 pr-1.5 pl-3.5 shadow-overlay duration-200 slide-in-from-bottom-3"
    >
      <span className="mr-[9px] whitespace-nowrap text-body-sm font-semibold text-t1">{count} selected</span>
      {actions.map((action) => (
        <button
          key={action.key}
          type="button"
          onClick={(event: MouseEvent<HTMLButtonElement>) => action.onSelect(event.currentTarget)}
          className={cn(
            'h-[27px] rounded-[7px] px-2.5 text-body-sm hover:bg-line-strong hover:text-t1',
            action.danger ? 'text-[#d97b7e]' : 'text-t2',
          )}
        >
          {action.label}
        </button>
      ))}
      <span aria-hidden="true" className="mx-[5px] h-[18px] w-px bg-line-strong" />
      <button
        type="button"
        aria-label="Clear selection"
        onClick={onClear}
        className="grid size-[27px] place-items-center rounded-[7px] text-t3 hover:bg-line-strong hover:text-t1"
      >
        <X className="size-2.5" strokeWidth={2.4} />
      </button>
    </div>
  )
}
