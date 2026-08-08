import { ChevronRight, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The heading above a group of rows. Sticky, so the reason a run of rows is
 * grouped stays on screen while you scroll through it — which is the whole
 * point of grouping by attention rather than sorting by date.
 */
export function TaskGroupHeader({
  label,
  count,
  color,
  hint,
  collapsed,
  first,
  allSelected,
  onToggle,
  onSelectGroup,
  onAdd,
}: {
  label: string
  count: number
  color?: string
  hint?: string
  collapsed: boolean
  /** The first heading sits tighter to the toolbar above it. */
  first: boolean
  allSelected: boolean
  onToggle: () => void
  onSelectGroup: () => void
  onAdd?: () => void
}) {
  return (
    <div
      className={cn(
        'group/head sticky top-0 z-[2] flex items-center gap-[9px] bg-bg pr-2.5 pb-[5px]',
        first ? 'mt-1.5' : 'mt-5',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex items-center gap-2 py-[3px]"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn('size-[9px] flex-none text-label-fg transition-transform duration-150', !collapsed && 'rotate-90')}
          strokeWidth={2.4}
        />
        <span
          className="whitespace-nowrap text-[11px] font-[650] uppercase tracking-[0.08em]"
          style={{ color: color ?? 'var(--t2)' }}
        >
          {label}
        </span>
        <span className="font-mono text-[11px] text-label-fg">{count}</span>
      </button>
      {hint && <span className="truncate text-meta-sm text-t4">{hint}</span>}
      <span className="flex-1" />
      <button
        type="button"
        onClick={onSelectGroup}
        className="h-[22px] rounded-sm px-[7px] text-meta-sm text-t3 opacity-0 hover:bg-soft hover:text-t1 focus-visible:opacity-100 group-hover/head:opacity-100"
      >
        {allSelected ? 'Deselect' : 'Select all'}
      </button>
      {onAdd && (
        <button
          type="button"
          aria-label={`Add a task to ${label}`}
          onClick={onAdd}
          className="grid size-[22px] place-items-center rounded-sm text-t4 opacity-0 hover:bg-soft hover:text-t1 focus-visible:opacity-100 group-hover/head:opacity-100"
        >
          <Plus className="size-[11px]" />
        </button>
      )}
    </div>
  )
}
