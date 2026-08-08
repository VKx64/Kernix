import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { LabelRow } from './label-row'

/**
 * One tile in the dashboard's metric row: label, a big mono value, and a note
 * that explains where the value came from. A tile marked `danger` turns both
 * the value and the note red — the label stays neutral, so a row of tiles still
 * scans as a row.
 */
export function MetricTile({
  label,
  value,
  note,
  danger = false,
  className,
}: {
  label: string
  value: ReactNode
  note?: ReactNode
  danger?: boolean
  className?: string
}) {
  return (
    <div
      data-slot="metric-tile"
      className={cn('flex flex-col gap-[7px] rounded-xl border border-line-soft px-3.5 py-[13px]', className)}
    >
      <LabelRow>{label}</LabelRow>
      <span
        className={cn(
          'font-mono text-metric tracking-[-0.02em]',
          danger ? 'text-danger' : 'text-t1',
        )}
      >
        {value}
      </span>
      {note !== undefined && (
        <span className={cn('text-meta-sm', danger ? 'text-danger' : 'text-t4')}>{note}</span>
      )}
    </div>
  )
}
