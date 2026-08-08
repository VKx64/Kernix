import type { ComponentProps } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import { cn } from '@/lib/utils'

/**
 * Two small things that look related but are not:
 *
 * `Chip` is pressable — a filter, a prompt suggestion, a saved view. It is a
 * hairline outline at rest and fills on hover, so a row of them stays quiet.
 *
 * `Tag` is not pressable. It labels a thing, and takes its colour from what it
 * labels: a 13% tint behind the colour itself.
 */
const chipVariants = cva(
  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3",
  {
    variants: {
      variant: {
        default: 'border border-line bg-transparent text-t2 hover:bg-soft hover:text-t1',
        active: 'border border-transparent bg-fill text-t1 font-semibold',
        ghost: 'border border-transparent text-t3 hover:bg-soft hover:text-t1',
      },
      size: {
        default: 'h-[26px] px-[11px] text-meta',
        sm: 'h-[22px] rounded-sm px-2 text-meta-sm',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export function Chip({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<'button'> & VariantProps<typeof chipVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      data-slot="chip"
      type={asChild ? undefined : 'button'}
      className={cn(chipVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export function Tag({
  color,
  className,
  style,
  ...props
}: { color?: string | null } & ComponentProps<'span'>) {
  return (
    <span
      data-slot="tag"
      className={cn(
        'inline-flex h-[17px] items-center rounded-sm px-[7px] text-[10px] font-semibold uppercase tracking-[0.04em]',
        !color && 'bg-soft text-t2',
        className,
      )}
      style={{
        ...(color ? { background: `color-mix(in oklab, ${color} 13%, transparent)`, color } : null),
        ...style,
      }}
      {...props}
    />
  )
}
