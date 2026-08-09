import type { SheetDateFormat, TimesheetLane } from '../types/api'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * A date as the payroll sheet wants it.
 *
 * Parsed by hand rather than through `new Date(iso)`, which would read a bare
 * `2026-08-03` as UTC midnight and hand back the 2nd to anyone west of
 * Greenwich. A date on a timesheet has no timezone — it is the day someone
 * worked.
 */
export function formatSheetDate(iso: string, format: SheetDateFormat = 'short'): string {
  const [year, month, day] = iso.split('-').map(Number)
  if (!year || !month || !day) return iso
  if (format === 'pad') return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  if (format === 'mon') return `${MONTHS[month - 1]} ${day}`
  return `${month}-${day}`
}

export interface SheetOptions {
  dateFormat?: SheetDateFormat
  /** Off by default: the rows usually land under headers that already exist. */
  header?: boolean
  /** Limit to one client's lane, for the per-lane Copy button. */
  clientId?: TimesheetLane['client_id']
}

export const SHEET_COLUMNS = ['Client', 'Date', 'Description', 'Hours'] as const

/**
 * The clipboard payload: tab-separated Client, Date, Description, Hours.
 *
 * Exactly the four columns a person would type, in the order they type them,
 * so it lands in A:D and leaves every formula in the sheet alone. There is no
 * total row and no rate column — the sheet computes its own totals, and
 * fighting it would be the wrong product.
 */
export function timesheetText(lanes: TimesheetLane[], options: SheetOptions = {}): string {
  const { dateFormat = 'short', header = false, clientId } = options
  const scoped = clientId === undefined ? lanes : lanes.filter((lane) => lane.client_id === clientId)
  const lines = scoped.flatMap((lane) =>
    lane.rows.map((row) => [lane.client, formatSheetDate(row.date, dateFormat), row.description, row.hours].join('\t')),
  )
  if (header) lines.unshift(SHEET_COLUMNS.join('\t'))
  return lines.join('\n')
}

export function countRows(lanes: TimesheetLane[], clientId?: TimesheetLane['client_id']): number {
  const scoped = clientId === undefined ? lanes : lanes.filter((lane) => lane.client_id === clientId)
  return scoped.reduce((total, lane) => total + lane.rows.length, 0)
}

/**
 * Copy text, falling back to a hidden textarea.
 *
 * The clipboard API needs a secure context, and this app is served over plain
 * HTTP inside the studio. The fallback is what actually runs there.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Denied or unavailable — the textarea below still works.
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('aria-hidden', 'true')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(area)
    return copied
  } catch {
    return false
  }
}

/** `2h 8m` as the timesheet writes it: hours and minutes, never bare minutes. */
export function hoursLabel(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  const hours = Math.floor(total / 60)
  const rest = total % 60
  if (!hours) return `${rest}m`
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}
