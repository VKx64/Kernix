import type { Project, Task, UserSummary } from '../types/api'
import { displayName } from './api'

/**
 * The inference the quick-capture modal does around the parser.
 *
 * The parser (`taskDraft.ts`) only ever reports what the person actually typed.
 * Everything here is a guess on top of that — which project a bare sentence
 * probably belongs to, who usually owns that project's work, whether the same
 * task already exists — so it is kept apart from parsing and every function is
 * pure, because a guess that cannot be tested is a guess nobody can trust.
 */

function lower(value: string): string {
  return value.toLowerCase()
}

function projectIdOf(task: Task): string {
  return String(task.projectId ?? task.project_id ?? task.project?.id ?? '')
}

/** Word-boundary test, so "seo" does not match "seoul". */
function mentions(haystack: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\b`).test(haystack)
}

/**
 * The project a title reads like it belongs to, when no `#project` token said
 * so outright.
 *
 * Project names win over client names — "Website Relaunch" is a stronger signal
 * than "Northwind" — and the caller's own fallback (the project being viewed,
 * or the last one used) is the last word before giving up.
 */
export function inferProjectId(title: string, projects: Project[], fallbackProjectId = ''): string {
  const needle = lower(title)
  if (needle.trim()) {
    for (const project of projects) {
      const words = lower(project.name).split(/\s+/).filter((word) => word.length > 2)
      if (words.some((word) => mentions(needle, word))) return String(project.id)
    }
    for (const project of projects) {
      const client = lower(project.client?.name ?? '')
      const words = client.split(/\s+/).filter((word) => word.length > 3)
      if (words.some((word) => mentions(needle, word))) return String(project.id)
    }
  }
  return fallbackProjectId
}

/**
 * Whoever picks up most of a project's work. Offered as a suggestion only —
 * the modal never assigns anyone without the person accepting it.
 */
export function suggestAssigneeUserId(projectId: string, tasks: Task[]): string {
  if (!projectId) return ''
  const counts = new Map<string, number>()
  for (const task of tasks) {
    if (projectIdOf(task) !== String(projectId)) continue
    const assignee = task.assignee?.id
    if (assignee === undefined || assignee === null) continue
    const key = String(assignee)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let best = ''
  let seen = 0
  for (const [key, count] of counts) {
    if (count > seen) {
      best = key
      seen = count
    }
  }
  return best
}

/** The first name a suggestion pill says, e.g. "Taylor usually owns this". */
export function firstNameOf(user: UserSummary | undefined | null): string {
  if (!user) return ''
  return String(user.firstName ?? user.first_name ?? displayName(user).split(' ')[0] ?? '')
}

/** Words worth comparing between two titles: alphanumeric, longer than three letters. */
export function captureKeywords(title: string): string[] {
  return lower(title)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 3)
}

/**
 * The existing task a new one most looks like, or null.
 *
 * Overlap is measured against at least two words, so a two-word title cannot
 * score 1.0 off a single shared word. This warns; it never blocks — people do
 * legitimately raise two tasks that sound alike.
 */
export function findDuplicateTask(title: string, tasks: Task[], threshold = 0.5): Task | null {
  const keywords = captureKeywords(title)
  if (keywords.length < 2) return null
  const denominator = Math.max(2, keywords.length)

  let best: Task | null = null
  let bestScore = 0
  for (const task of tasks) {
    const other = new Set(captureKeywords(task.title))
    if (!other.size) continue
    const shared = keywords.filter((word) => other.has(word)).length
    const score = shared / denominator
    if (score > bestScore) {
      bestScore = score
      best = task
    }
  }
  return bestScore >= threshold ? best : null
}

/**
 * `3h`, `3h 30`, `90m`, `2d` or a bare number of minutes. Anything else is left
 * as the person typed it and no estimate is sent.
 */
export function parseEstimateMinutes(value: string): number | null {
  const text = value.toLowerCase().trim()
  if (!text) return null
  const hours = /(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?(?:\s*(\d+))?/.exec(text)
  if (hours) return Math.round(Number(hours[1]) * 60) + (hours[2] ? Number(hours[2]) : 0)
  const minutes = /(\d+)\s*m/.exec(text)
  if (minutes) return Number(minutes[1])
  const days = /(\d+)\s*d/.exec(text)
  if (days) return Number(days[1]) * 480
  const bare = /^\d+$/.exec(text)
  return bare ? Number(bare[0]) : null
}

export interface AiTaskDraft {
  /** Checklist steps, in order. */
  steps: string[]
  /** The note that goes in the description field. */
  note: string
  /** `high` when the title reads like something that cannot wait. */
  urgency: 'high' | 'normal'
  /** Steps × 45 minutes — a starting figure, not a promise. */
  estimateMinutes: number
}

const AI_BRANCHES: Array<{ match: RegExp; steps: string[]; note: string }> = [
  {
    match: /deploy|ship|release|launch|rollout/,
    steps: [
      'Confirm the change list and owners',
      'Run pre-deploy checks on staging',
      'Deploy and watch error rates for 30 minutes',
      'Post the outcome in the channel',
    ],
    note: 'Coordinate the release window and make sure someone is watching dashboards afterwards. Roll back if error rates move.',
  },
  {
    match: /password|auth|security|token|credential|otp|login|leak/,
    steps: [
      'Reproduce on staging',
      'Patch and add a regression test',
      'Rotate anything exposed',
      'Confirm the fix with the auditor',
    ],
    note: 'Treat as a security fix: reproduce first, patch behind a test, then rotate any credential or session the issue could have exposed.',
  },
  {
    match: /design|redesign|rebuild|revamp|ux|copy/,
    steps: ['Audit what exists today', 'Draft two directions', 'Review with the team', 'Ship behind a flag'],
    note: 'Start from what is live now so the change is measurable. Two directions, one review, then ship behind a flag.',
  },
  {
    match: /bug|fix|error|broken|fails|timeout/,
    steps: [
      'Reproduce and capture the trace',
      'Write a failing test',
      'Fix and verify',
      'Check for the same pattern elsewhere',
    ],
    note: 'Reproduce before changing anything, and leave a failing test behind so this cannot regress silently.',
  },
]

const AI_FALLBACK = {
  steps: ['Agree what done looks like', 'Do the work', 'Review with someone', 'Close the loop with whoever asked'],
  note: 'Scope this before starting — a short definition of done saves a round trip later.',
}

const AI_ESCALATES = /deploy|security|password|critical|urgent|broken|leak/

/**
 * The draft "Draft with AI" produces. Deterministic and local by design: the
 * shape of the output is fixed by the spec, so this is a working stand-in until
 * a real drafting endpoint exists, and swapping it out changes nothing else in
 * the modal.
 *
 * `suggestedOwnerFirstName` is passed only when the owner was inferred rather
 * than typed — the note then says why that person is on it.
 */
export function draftTaskWithAi(title: string, suggestedOwnerFirstName = ''): AiTaskDraft {
  const needle = lower(title)
  const branch = AI_BRANCHES.find((candidate) => candidate.match.test(needle)) ?? AI_FALLBACK
  const note = suggestedOwnerFirstName
    ? `${branch.note} ${suggestedOwnerFirstName} has picked up most of this project recently.`
    : branch.note

  return {
    steps: branch.steps,
    note,
    urgency: AI_ESCALATES.test(needle) ? 'high' : 'normal',
    estimateMinutes: branch.steps.length * 45,
  }
}
