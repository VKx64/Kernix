/**
 * Identity colour. The design gives every person a colour and uses it as a 14–16%
 * tint behind their initials, which is what makes a dense list of avatars
 * readable without photographs. The server does not store one, so it is derived
 * here from a stable key — the same person gets the same colour on every screen
 * and across reloads.
 *
 * The palette is the design's own set of person colours. It deliberately reuses
 * the signal hues: an avatar is small and tinted, so it never reads as a status.
 */
const PERSON_COLORS = [
  '#7b7ff6',
  '#4cb963',
  '#e8a33d',
  '#f2585b',
  '#57a6f0',
  '#c98bd8',
  '#8bc9d8',
  '#d8c48b',
  '#d88b8b',
] as const

export function personColor(key: string | number | null | undefined): string {
  const text = String(key ?? '')
  if (!text) return PERSON_COLORS[0]
  // FNV-1a, so a one-character difference in the key lands somewhere else in
  // the palette rather than next door.
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return PERSON_COLORS[Math.abs(hash) % PERSON_COLORS.length]
}

/** A 14% wash of a colour, the design's tint for badges and monograms. */
export function tint(color: string, percent = 14) {
  return `color-mix(in oklab, ${color} ${percent}%, transparent)`
}
