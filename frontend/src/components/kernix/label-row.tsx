import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * The uppercase label that sits above a block of content. One of the design's
 * recurring patterns, so it is a component rather than four copies of the same
 * three utilities: 10.5px, weight 600, 0.1em tracking, a shade under `t3`.
 */
export function LabelRow({ className, children, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="label-row"
      className={cn('text-label uppercase text-label-fg', className)}
      {...props}
    >
      {children}
    </div>
  )
}
