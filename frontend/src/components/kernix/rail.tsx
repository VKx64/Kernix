import type { CSSProperties } from 'react'

/** Neutral rail. What a low-urgency row or an unrated card gets. */
export const RAIL_NEUTRAL = 'var(--rail)'

/**
 * The urgency rail: a 2px left border that carries how pressing a row is, so
 * the list needs no urgency column. Returned as a style rather than a wrapper
 * element because every consumer — task row, focus row, card — already has a
 * container of its own to hang it on.
 *
 * Pass `null` for anything not worth a colour; the rail stays but goes neutral,
 * which keeps every row in a list the same width.
 */
export function urgencyRail(color?: string | null): CSSProperties {
  return { borderLeft: `2px solid ${color || RAIL_NEUTRAL}` }
}

/**
 * The health rail: the same idea rotated onto the top edge, used on client and
 * project cards where the signal is delivery health rather than urgency.
 */
export function healthRail(color?: string | null): CSSProperties {
  return { borderTop: `2px solid ${color || RAIL_NEUTRAL}` }
}
