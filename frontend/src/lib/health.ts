/**
 * Delivery health, and the words and colours it wears.
 *
 * The rule itself lives on the server so a card and a detail page can never
 * disagree; this is only the presentation of the four values it returns.
 */
export type Health = 'ontrack' | 'atrisk' | 'offtrack' | 'done'

interface HealthPresentation {
  label: string
  /** A token reference, so health colour stays in the token file. */
  color: string
}

const HEALTH: Record<Health, HealthPresentation> = {
  ontrack: { label: 'On track', color: 'var(--good)' },
  atrisk: { label: 'At risk', color: 'var(--warn)' },
  offtrack: { label: 'Off track', color: 'var(--danger)' },
  done: { label: 'Complete', color: 'var(--t3)' },
}

export function healthOf(value: unknown): HealthPresentation {
  return HEALTH[(value as Health) ?? 'ontrack'] ?? HEALTH.ontrack
}

export interface PortfolioStats {
  total: number
  done: number
  open: number
  overdue: number
  blocked: number
  unowned: number
  logged_minutes: number
  estimated_minutes: number
  budget_minutes: number | null
  percent_complete: number
  health: Health
}

/**
 * The one line under a project name: what is wrong, or how much is left.
 *
 * Trouble is named before volume — "2 overdue" is what a person needs, and
 * "7 open" only earns the space when there is nothing wrong to report.
 */
export function healthDetail(stats: Pick<PortfolioStats, 'overdue' | 'blocked' | 'open'>): string {
  const bits: string[] = []
  if (stats.overdue) bits.push(`${stats.overdue} overdue`)
  if (stats.blocked) bits.push(`${stats.blocked} blocked`)
  if (!bits.length) bits.push(`${stats.open} open`)
  return bits.join(' · ')
}
