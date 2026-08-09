import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { LabelRow } from './label-row'

/**
 * The bordered panel every read-only surface is built from: a label row on
 * top, an optional right-aligned meta, and content below.
 *
 * An empty panel says its one sentence quietly rather than rendering the
 * bordered empty state — inside a panel that already has a border, the full
 * treatment reads as an error rather than as calm.
 */
export function PanelSection({
  label,
  meta,
  empty,
  className,
  children,
}: {
  label: string
  meta?: ReactNode
  /** A sentence when there is nothing to show, or false to always render children. */
  empty?: string | false
  className?: string
  children?: ReactNode
}) {
  return (
    <section className={cn('flex flex-col rounded-xl border border-line-soft px-[15px] pb-3 pt-3.5', className)}>
      <div className="mb-[9px] flex items-baseline gap-2.5">
        <LabelRow>{label}</LabelRow>
        <span className="flex-1" />
        {typeof meta === 'string' ? <span className="text-meta text-t4">{meta}</span> : meta}
      </div>
      {empty ? <p className="pb-1 text-meta text-t4">{empty}</p> : children}
    </section>
  )
}
