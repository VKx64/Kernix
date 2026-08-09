import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * The design's type scale and its colour ramp both live under `text-`, so
 * `text-meta-sm` is a size and `text-t3` is a colour and tailwind-merge cannot
 * tell them apart on its own. Left unconfigured it treats them as one group
 * and silently drops whichever came first — which is how a 11.5px preview line
 * quietly rendered at 13px.
 *
 * Naming both groups is the fix, and it has to be done here rather than at each
 * call site: every `cn('text-<size>', condition && 'text-<colour>')` in the app
 * depends on it.
 */
const FONT_SIZES = [
  'label', 'meta-sm', 'meta', 'body-sm', 'body', 'body-lg', 'title', 'metric', 'h1',
] as const

const TEXT_COLORS = [
  't1', 't2', 't3', 't4', 't5', 't6',
  'title', 'title-strong', 'label-fg',
  'brand', 'brand-hover', 'danger', 'warn', 'good', 'good-dim',
  'bg', 'surface', 'inset', 'elev', 'elev-low', 'soft', 'fill', 'rail',
  'line', 'line-soft', 'line-strong',
  'foreground', 'muted-foreground', 'primary', 'primary-foreground',
  'secondary-foreground', 'accent-foreground', 'destructive', 'success', 'warning',
  'card-foreground', 'popover-foreground', 'sidebar-foreground', 'sidebar-accent-foreground',
] as const

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...FONT_SIZES] }],
      'text-color': [{ text: [...TEXT_COLORS] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
