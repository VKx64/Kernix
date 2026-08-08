import type { FieldValue, Project, UserSummary } from '../types/api'

export interface ParsedTaskDraft {
  /** The title with every recognised token removed and whitespace collapsed. */
  title: string
  assigneeUserId?: string
  urgencyValueId?: string
  projectId?: string
  /** ISO `YYYY-MM-DD`. */
  dueDate?: string
}

export interface ParseTaskDraftContext {
  users: UserSummary[]
  urgencyOptions: FieldValue[]
  /** Omit to leave `#project` tokens in the title untouched. */
  projects?: Project[]
  now: Date
  /** The value is final, so a token at the end of the string may resolve. */
  settled?: boolean
}

interface Span {
  start: number
  end: number
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Same shape as `displayName` in `lib/api`, kept local so the parser has no side-effecting imports. */
function fullName(user: UserSummary): string {
  return user.name || [user.firstName ?? user.first_name, user.lastName ?? user.last_name].filter(Boolean).join(' ')
}

function firstName(user: UserSummary): string {
  return String(user.firstName ?? user.first_name ?? '')
}

function findUser(token: string, users: UserSummary[]): UserSummary | undefined {
  const needle = normalize(token)
  if (!needle) return undefined
  return users.find((user) => {
    const username = user.username ? normalize(user.username) : ''
    const first = normalize(firstName(user))
    const full = normalize(fullName(user))
    return needle === username || needle === first || needle === full
  })
}

/**
 * `#project` matches on the whole name with punctuation and spaces stripped, so
 * `#websiterelaunch` finds "Website Relaunch". A prefix match is accepted only
 * when exactly one project starts with the token — two candidates mean the
 * person is still typing, and guessing between them would file the task
 * somewhere they did not choose.
 */
function findProject(token: string, projects: Project[]): Project | undefined {
  const needle = normalize(token)
  if (!needle) return undefined
  const exact = projects.find((project) => normalize(project.name) === needle)
  if (exact) return exact
  const prefixed = projects.filter((project) => normalize(project.name).startsWith(needle))
  return prefixed.length === 1 ? prefixed[0] : undefined
}

// "!urgent" has no matching label most of the time, so it also accepts "high" —
// the rest map onto themselves.
const URGENCY_KEYWORD_LABELS: Record<string, string[]> = {
  urgent: ['urgent', 'high'],
  high: ['high'],
  normal: ['normal', 'medium'],
  low: ['low'],
}

function findUrgency(keyword: string, urgencyOptions: FieldValue[]): FieldValue | undefined {
  const candidates = URGENCY_KEYWORD_LABELS[keyword.toLowerCase()] ?? [keyword.toLowerCase()]
  for (const candidate of candidates) {
    const match = urgencyOptions.find((option) => option.label.trim().toLowerCase() === candidate)
    if (match) return match
  }
  return undefined
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const WEEKDAY_SHORT = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
// Longer alternatives listed first so e.g. "monday" is not swallowed by "mon".
const WEEKDAY_PATTERN = `(?:${WEEKDAYS.join('|')}|${WEEKDAY_SHORT.join('|')})`

const MONTHS = [
  ['jan', 'january'], ['feb', 'february'], ['mar', 'march'], ['apr', 'april'], ['may', 'may'], ['jun', 'june'],
  ['jul', 'july'], ['aug', 'august'], ['sep', 'september'], ['oct', 'october'], ['nov', 'november'], ['dec', 'december'],
]
const MONTH_PATTERN = MONTHS.map(([, full]) => full).concat(MONTHS.map(([short]) => short)).join('|')

function monthIndex(token: string): number {
  const needle = token.toLowerCase()
  return MONTHS.findIndex(([short, full]) => needle === short || needle === full)
}

function toIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function addDays(now: Date, days: number): Date {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  next.setDate(next.getDate() + days)
  return next
}

/** Resolves the next occurrence of a weekday, never today — "monday" said on a Monday means next Monday. */
function nextWeekday(now: Date, targetDow: number): Date {
  const delta = (targetDow - now.getDay() + 7) % 7 || 7
  return addDays(now, delta)
}

/** Rolls a bare month/day into next year once that date has already passed this year. */
function resolveMonthDay(now: Date, month: number, day: number): Date {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let year = now.getFullYear()
  let candidate = new Date(year, month, day)
  if (candidate < startOfToday) {
    year += 1
    candidate = new Date(year, month, day)
  }
  return candidate
}

interface DateMatch extends Span {
  iso: string
}

const DATE_MATCHERS: Array<{ regex: RegExp; resolve: (match: RegExpExecArray, now: Date) => string }> = [
  { regex: /\b\d{4}-\d{2}-\d{2}\b/, resolve: (match) => match[0] },
  { regex: /\bin\s+(\d+)\s+days?\b/i, resolve: (match, now) => toIso(addDays(now, Number(match[1]))) },
  { regex: /\bnext week\b/i, resolve: (_match, now) => toIso(addDays(now, 7)) },
  { regex: /\btoday\b/i, resolve: (_match, now) => toIso(now) },
  { regex: /\btomorrow\b/i, resolve: (_match, now) => toIso(addDays(now, 1)) },
  {
    regex: new RegExp(`\\b${WEEKDAY_PATTERN}\\b`, 'i'),
    resolve: (match, now) => {
      const needle = match[0].toLowerCase()
      const index = WEEKDAYS.indexOf(needle) >= 0 ? WEEKDAYS.indexOf(needle) : WEEKDAY_SHORT.indexOf(needle)
      return toIso(nextWeekday(now, index))
    },
  },
  {
    // "aug 12"
    regex: new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{1,2})\\b`, 'i'),
    resolve: (match, now) => toIso(resolveMonthDay(now, monthIndex(match[1]), Number(match[2]))),
  },
  {
    // "12 aug"
    regex: new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_PATTERN})\\b`, 'i'),
    resolve: (match, now) => toIso(resolveMonthDay(now, monthIndex(match[2]), Number(match[1]))),
  },
]

function findDate(title: string, now: Date): DateMatch | undefined {
  let best: DateMatch | undefined
  for (const matcher of DATE_MATCHERS) {
    const match = matcher.regex.exec(title)
    if (!match) continue
    const start = match.index
    const end = start + match[0].length
    if (!best || start < best.start || (start === best.start && end - start > best.end - best.start)) {
      best = { start, end, iso: matcher.resolve(match, now) }
    }
  }
  return best
}

/**
 * Trailing whitespace survives while the title is being typed. Trimming it
 * would swallow the space the user just pressed, so the next character would
 * land against the previous word.
 */
function removeSpans(title: string, spans: Span[], settled: boolean): string {
  const sorted = spans.slice().sort((a, b) => b.start - a.start)
  let next = title
  for (const span of sorted) {
    next = next.slice(0, span.start) + next.slice(span.end)
  }
  const collapsed = next.replace(/[^\S\n]+/g, ' ')
  return settled ? collapsed.trim() : collapsed.replace(/^\s+/, '')
}

/**
 * Pulls `@assignee`, `!priority`, `#project`, and due-date tokens out of a task
 * title.
 * Only ever removes a token it can actually resolve — an `@name` matching no
 * one, or an unrecognised `!word`, is left in the title untouched.
 *
 * A token that runs to the end of the string is still being typed, so it is
 * left alone until something follows it. Without that rule, typing `@casey`
 * on the way to `@caseyanne` would resolve and vanish at the sixth character,
 * stranding the rest of the name. Pass `settled` when the value is final — on
 * submit or blur — to resolve a trailing token too.
 */
export function parseTaskDraftTitle(rawTitle: string, context: ParseTaskDraftContext): ParsedTaskDraft {
  const spans: Span[] = []
  const result: ParsedTaskDraft = { title: rawTitle }
  const finished = (end: number) => context.settled || end < rawTitle.length

  const mention = /@([A-Za-z0-9_.'-]+)/.exec(rawTitle)
  if (mention) {
    const end = mention.index + mention[0].length
    const user = findUser(mention[1], context.users)
    if (user && finished(end)) {
      result.assigneeUserId = String(user.id)
      spans.push({ start: mention.index, end })
    }
  }

  const priority = /!(urgent|high|normal|low)\b/i.exec(rawTitle)
  if (priority) {
    const end = priority.index + priority[0].length
    const urgency = findUrgency(priority[1], context.urgencyOptions)
    if (urgency && finished(end)) {
      result.urgencyValueId = String(urgency.id)
      spans.push({ start: priority.index, end })
    }
  }

  const project = /#([A-Za-z0-9_.'-]+)/.exec(rawTitle)
  if (project && context.projects?.length) {
    const end = project.index + project[0].length
    const match = findProject(project[1], context.projects)
    if (match && finished(end)) {
      result.projectId = String(match.id)
      spans.push({ start: project.index, end })
    }
  }

  const date = findDate(rawTitle, context.now)
  if (date && finished(date.end)) {
    result.dueDate = date.iso
    spans.push({ start: date.start, end: date.end })
  }

  result.title = spans.length ? removeSpans(rawTitle, spans, Boolean(context.settled)) : rawTitle
  return result
}
