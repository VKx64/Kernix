import { cn } from '@/lib/utils'

/**
 * The Today / This week style toggle. A real radio group so arrow keys move
 * between options and a screen reader reads it as one control, styled as the
 * design's inset track: a 9px-radius well at `elev-low` holding 26px options,
 * the selected one lifted to `line-strong` and `t1`.
 */
export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Names the group for assistive technology. */
  label: string
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-slot="segmented"
      className={cn('inline-flex flex-none items-center gap-0.5 rounded-[9px] bg-elev-low p-0.5', className)}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              'h-[26px] cursor-pointer whitespace-nowrap rounded-[7px] px-[11px] text-meta font-[550] transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              selected ? 'bg-line-strong text-t1' : 'text-t3 hover:text-t2',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
