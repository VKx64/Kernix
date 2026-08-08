import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * The identity tile used for clients, projects and workspaces: a rounded
 * square carrying one or two initials at weight 700. Given a colour it renders
 * as a 14% tint of that colour with the colour itself as the text; without
 * one it falls back to the neutral fill, which is what the detail pages use
 * when the entity has no colour of its own.
 *
 * Sizes come from the design's 20–56px range. Radius and type scale with the
 * tile so a 22px lane marker and a 44px page header read as one family.
 */
const SIZES = {
  xs: { box: 20, radius: 6, text: 9.5 },
  sm: { box: 22, radius: 7, text: 10.5 },
  md: { box: 28, radius: 8, text: 11 },
  lg: { box: 44, radius: 12, text: 16 },
  xl: { box: 56, radius: 14, text: 19 },
} as const

export type MonogramSize = keyof typeof SIZES

export function initialsOf(name: string, max = 2) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, max)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

export function Monogram({
  name,
  color,
  size = 'sm',
  initials,
  className,
  style,
  ...props
}: {
  name: string
  color?: string | null
  size?: MonogramSize
  /** Overrides the initials derived from `name`. */
  initials?: string
} & Omit<ComponentProps<'span'>, 'children'>) {
  const metrics = SIZES[size]
  const label = initials ?? initialsOf(name, size === 'xs' || size === 'sm' ? 1 : 2)

  return (
    <span
      aria-hidden="true"
      data-slot="monogram"
      className={cn(
        'grid flex-none place-items-center font-semibold',
        !color && 'bg-fill text-t2',
        className,
      )}
      style={{
        width: metrics.box,
        height: metrics.box,
        borderRadius: metrics.radius,
        fontSize: metrics.text,
        fontWeight: 700,
        ...(color ? { background: `color-mix(in oklab, ${color} 14%, transparent)`, color } : null),
        ...style,
      }}
      {...props}
    >
      {label}
    </span>
  )
}
