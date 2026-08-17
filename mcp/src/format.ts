/**
 * Rendering for tool results.
 *
 * Handing an assistant raw Kernix JSON works but wastes most of the context
 * window on keys it never reads — a task row carries 28 fields of which six
 * matter to a project manager. Everything here renders one entity per line in a
 * stable order, so a fifty-task list costs a few hundred tokens instead of
 * several thousand, and the id needed for a follow-up call is always the first
 * thing on the line.
 */

export interface FieldRef {
  id: number;
  key_name?: string;
  label?: string;
}

export interface TaskRow {
  id: number;
  title: string;
  due_date?: string | null;
  estimated_minutes?: number | null;
  actual_minutes?: number | null;
  subtasks_count?: number;
  completed_subtasks_count?: number;
  status?: FieldRef | null;
  type?: FieldRef | null;
  urgency?: FieldRef | null;
  assignee?: { id: number; name?: string; username?: string } | null;
  task_assignees?: Array<{ id: number; name?: string; username?: string }>;
  project?: { id: number; name: string; client?: { id: number; name: string } | null } | null;
  folder?: { id: number; name: string } | null;
  description?: string | null;
}

/**
 * The workspace's own timezone, set once from `/api/bootstrap`.
 *
 * This matters more than it looks. Kernix stores a due date as local midnight
 * and serialises it as the equivalent UTC instant, so a task due 20 August in
 * Manila comes back as `2026-08-19T16:00:00Z`. Reading the date straight off
 * that string reports every due date a day early — which for a tool whose whole
 * job is chasing deadlines is worse than useless.
 */
let displayZone = 'UTC';

export function setDisplayZone(zone: string | null | undefined): void {
  if (!zone) return;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone });
    displayZone = zone;
  } catch {
    // An unknown zone name is not worth failing over; UTC stays in place.
  }
}

export function displayTimezone(): string {
  return displayZone;
}

/** ISO timestamp to the calendar date it represents in the workspace timezone. */
export function day(value?: string | null): string | null {
  if (!value) return null;
  // A bare `YYYY-MM-DD` is already local and must not be shifted.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
  }
  // en-CA yields YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: displayZone }).format(new Date(parsed));
}

/** Today's date in the workspace timezone, as YYYY-MM-DD. */
export function today(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: displayZone }).format(now);
}

/** Minutes to the h/m form the product itself uses. */
export function duration(minutes?: number | null): string | null {
  if (minutes === null || minutes === undefined) return null;
  if (minutes === 0) return '0m';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/**
 * How late or how soon, relative to today. A project manager asks "what is
 * overdue" far more often than "what is due on the 14th", so the relative form
 * is what the line leads with.
 */
export function whenDue(dueDate?: string | null, now = new Date()): string {
  const due = day(dueDate);
  if (!due) return 'no due date';
  // Both sides are calendar dates in the workspace timezone, so the difference
  // is a plain day count with no zone arithmetic left to get wrong.
  const midnight = Date.parse(`${today(now)}T00:00:00Z`);
  const target = Date.parse(`${due}T00:00:00Z`);
  const days = Math.round((target - midnight) / 86_400_000);
  if (days === 0) return `due today (${due})`;
  if (days === 1) return `due tomorrow (${due})`;
  if (days === -1) return `1 day overdue (${due})`;
  if (days < 0) return `${Math.abs(days)} days overdue (${due})`;
  return `due in ${days} days (${due})`;
}

export function taskLine(task: TaskRow, today?: Date): string {
  const bits: string[] = [];
  const client = task.project?.client?.name;
  const project = task.project?.name;
  if (project) bits.push(client ? `${client} / ${project}` : project);
  if (task.status?.label) bits.push(task.status.label);
  if (task.urgency?.label && task.urgency.key_name !== 'normal') bits.push(task.urgency.label);
  bits.push(whenDue(task.due_date, today));

  const people = (task.task_assignees ?? []).map((person) => person.name ?? person.username ?? `#${person.id}`);
  bits.push(people.length ? people.join(', ') : 'unassigned');

  const estimated = duration(task.estimated_minutes);
  const actual = duration(task.actual_minutes);
  if (estimated || actual) bits.push(`${actual ?? '0m'} of ${estimated ?? 'no estimate'}`);
  if (task.subtasks_count) bits.push(`${task.completed_subtasks_count ?? 0}/${task.subtasks_count} subtasks`);

  return `#${task.id} ${task.title} — ${bits.join(' · ')}`;
}

export function taskDetail(task: TaskRow, extras: Record<string, string | null | undefined> = {}): string {
  const lines = [
    `#${task.id} ${task.title}`,
    `  project: ${task.project?.client?.name ? `${task.project.client.name} / ` : ''}${task.project?.name ?? 'none'}`,
    `  folder: ${task.folder?.name ?? 'none'}`,
    `  status: ${task.status?.label ?? 'unknown'} · type: ${task.type?.label ?? 'unknown'} · urgency: ${task.urgency?.label ?? 'unknown'}`,
    `  due: ${whenDue(task.due_date)}`,
    `  assignees: ${(task.task_assignees ?? []).map((p) => p.name ?? p.username).join(', ') || 'unassigned'}`,
    `  time: ${duration(task.actual_minutes) ?? '0m'} logged of ${duration(task.estimated_minutes) ?? 'no estimate'}`,
  ];
  for (const [label, value] of Object.entries(extras)) {
    if (value) lines.push(`  ${label}: ${value}`);
  }
  if (task.description) {
    lines.push('  description:');
    for (const line of task.description.split('\n')) lines.push(`    ${line}`);
  }
  return lines.join('\n');
}

/** A heading that states how much of the result set the caller is looking at. */
export function listHeader(
  what: string,
  shown: number,
  meta?: { total: number; current_page: number; last_page: number },
): string {
  if (!meta) return `${shown} ${what}`;
  const range = meta.last_page > 1 ? ` (page ${meta.current_page} of ${meta.last_page})` : '';
  const truncated = shown < meta.total ? `, showing ${shown}` : '';
  return `${meta.total} ${what}${truncated}${range}`;
}

export function bullets(lines: Array<string | null | undefined>): string {
  const kept = lines.filter((line): line is string => Boolean(line));
  return kept.length ? kept.join('\n') : '(none)';
}
