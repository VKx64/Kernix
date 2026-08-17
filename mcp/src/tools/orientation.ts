import { z } from 'zod';
import { unwrap } from '../client.js';
import { bullets, day, duration, taskLine, today } from '../format.js';
import { displayName } from '../vocabulary.js';
import { guard, text, type ToolContext } from './context.js';

/**
 * The tools an assistant should reach for first: who it is acting as, what
 * words this workspace uses, and what the portfolio looks like right now.
 */
export function registerOrientation({ server, client, vocab, config }: ToolContext): void {
  server.registerTool(
    'kernix_whoami',
    {
      title: 'Who am I in Kernix',
      description:
        'The account this server acts as, its role and permissions, and whether writes are enabled. ' +
        'Call this first: every other tool is limited by what this account may do.',
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        const boot = await vocab.load(true);
        const manageable = boot.permissions.filter((p) => !p.endsWith('.view')).length;

        // Which workspace this token lands in decides what every other tool can
        // see, so it is the first thing worth stating. Kernix scopes by the
        // account's active workspace; the server holds no workspace of its own.
        let workspace: string | null = null;
        try {
          const rows = unwrap(
            await client.get<{ data: Array<{ name: string; active?: boolean; member_count?: number }> }>(
              '/api/workspaces',
            ),
          );
          const current = rows.find((row) => row.active) ?? rows[0];
          workspace = current ? `${current.name} (${current.member_count ?? '?'} members)` : null;
        } catch {
          // Listing workspaces is its own permission; not knowing the name is
          // not a reason to fail the whole orientation call.
        }

        return text(
          bullets([
            `Signed in as ${displayName(boot.user)} (@${boot.user.username}, id ${boot.user.id})`,
            workspace ? `Workspace: ${workspace}` : null,
            boot.user.role?.name ? `Role: ${boot.user.role.name}` : null,
            `Permissions: ${boot.permissions.length} total, ${manageable} beyond read-only`,
            `Writes: ${config.allowWrites ? 'enabled' : 'DISABLED — this server is read-only, set KERNIX_ALLOW_WRITES=1 to change that'}`,
            config.allowWrites
              ? `Clock gate: ${config.adminOverride ? 'bypassed by admin override' : 'active — task changes need an open work session, see kernix_clock_state'}`
              : null,
            `Kernix: ${config.baseUrl}`,
            // Reported from the permission set rather than the bootstrap
            // payload: that payload lists clients even for an account that
            // cannot open the clients screen, which would promise access this
            // token does not have.
            `Reachable: ${describeAccess(boot.permissions)}`,
            `Projects visible: ${boot.projects?.length ?? 0} · People: ${(await vocab.people()).length}`,
          ]),
        );
      }),
  );

  server.registerTool(
    'kernix_vocabulary',
    {
      title: 'Valid status, urgency and type values',
      description:
        'The exact status, urgency and type names this workspace accepts. Every tool that writes one of these ' +
        'takes a name from this list, not an id. Call this before changing a task if unsure.',
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        const boot = await vocab.load();
        const lines: string[] = [];
        for (const field of boot.fields) {
          const options = field.values
            .slice()
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((value) => value.key_name)
            .join(', ');
          lines.push(`${field.key_name} (${field.name}): ${options}`);
        }
        return text(bullets(lines));
      }),
  );

  server.registerTool(
    'kernix_dashboard',
    {
      title: 'Portfolio snapshot',
      description:
        'What needs attention right now across the whole workspace: counts due and overdue, time tracked, ' +
        'retainer burn, and the tasks the product itself surfaces as needing attention.',
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        const board = unwrap(await client.get<{ data: Record<string, unknown> }>('/api/dashboard'));
        const lines: string[] = [`Kernix on ${board.date} (${board.range})`];

        // The dashboard's rows are its own compact shape, not task records:
        // `project` and `client` are plain strings and status is a label only.
        const metrics = (board.metrics ?? {}) as Record<string, { count?: number; minutes?: number; percent?: number; note?: string }>;
        lines.push(
          `Due today: ${metrics.due_today?.count ?? 0} · Overdue: ${metrics.overdue?.count ?? 0} · ` +
            `Tracked today: ${duration(metrics.tracked_today?.minutes) ?? '0m'} ${metrics.tracked_today?.note ?? ''}`.trim(),
          `Retainer burn: ${metrics.retainer_burn?.percent ?? 0}% ${metrics.retainer_burn?.note ?? ''}`.trim(),
          `Tracked this week: ${duration(board.week_total_minutes as number) ?? '0m'} ` +
            `(last week ${duration(board.last_week_total_minutes as number) ?? '0m'}, ` +
            `daily target ${duration(board.daily_target_minutes as number) ?? 'none'})`,
        );

        const retainer = board.retainer as Record<string, number | string> | undefined;
        if (retainer) {
          lines.push(
            `${retainer.month_label}: ${duration(retainer.used_minutes as number) ?? '0m'} used of ` +
              `${duration(retainer.capacity_minutes as number) ?? 'no capacity'}, ` +
              `projected ${duration(retainer.projected_minutes as number) ?? '0m'} by month end`,
          );
        }

        const focus = board.focus as Array<Record<string, unknown>> | undefined;
        if (focus?.length) {
          lines.push('', 'work on next:');
          for (const row of focus) lines.push(`  ${summaryLine(row)}`);
        }

        const attention = board.needs_attention as Array<Record<string, unknown>> | undefined;
        lines.push('', `needs attention: ${attention?.length ? '' : 'nothing late, blocked or untouched'}`);
        for (const row of attention ?? []) lines.push(`  ${summaryLine(row)}`);

        const upcoming = board.upcoming as Array<{ label?: string; tasks?: Array<Record<string, unknown>> }> | undefined;
        if (upcoming?.length) {
          lines.push('', 'upcoming:');
          for (const group of upcoming) {
            for (const row of group.tasks ?? []) lines.push(`  ${group.label}: ${summaryLine(row)}`);
          }
        }

        const activity = board.activity as Array<{ text?: string; at?: string }> | undefined;
        if (activity?.length) {
          lines.push('', 'recent activity:');
          for (const row of activity.slice(0, 8)) {
            lines.push(`  ${String(row.at ?? '').slice(0, 10)} ${row.text}`);
          }
        }

        return text(bullets(lines));
      }),
  );

  server.registerTool(
    'kernix_workload',
    {
      title: 'Who is carrying what',
      description:
        'Open task count, overdue count and estimated hours per person, worst first. Use this to spot who is ' +
        'overloaded before assigning more work, or to answer "who has capacity".',
      inputSchema: {
        project: z.string().optional().describe('Limit to one project, by name or id.'),
      },
    },
    async ({ project }) =>
      guard(async () => {
        await vocab.load();
        const query: Record<string, string | number> = { view: 'all', per_page: 100 };
        if (project) {
          const projects = unwrap(
            await client.get<{ data: Array<{ id: number; name: string }> }>('/api/projects', { per_page: 200 }),
          );
          const wanted = /^\d+$/.test(project)
            ? projects.find((p) => p.id === Number(project))
            : projects.find((p) => p.name.toLowerCase().includes(project.toLowerCase()));
          if (!wanted) return text(`No project matches "${project}".`);
          query.project_id = wanted.id;
        }

        const page = await client.get<{ data: Array<Record<string, unknown>> }>('/api/tasks', query);
        const rows = page.data;

        interface Tally { open: number; overdue: number; minutes: number }
        const byPerson = new Map<string, Tally>();
        const todayIso = today();

        for (const row of rows) {
          const status = (row.status as { key_name?: string } | null)?.key_name;
          if (status === 'complete') continue;
          const due = day(row.due_date as string);
          const assignees = (row.task_assignees as Array<{ name?: string; username?: string }>) ?? [];
          const names = assignees.length ? assignees.map((p) => p.name ?? p.username ?? '?') : ['(unassigned)'];
          for (const name of names) {
            const tally = byPerson.get(name) ?? { open: 0, overdue: 0, minutes: 0 };
            tally.open += 1;
            if (due && due < todayIso) tally.overdue += 1;
            tally.minutes += Number(row.estimated_minutes ?? 0);
            byPerson.set(name, tally);
          }
        }

        const ordered = [...byPerson.entries()].sort(
          (a, b) => b[1].overdue - a[1].overdue || b[1].open - a[1].open,
        );
        return text(
          bullets([
            `Open work across ${ordered.length} people${project ? ` on ${project}` : ''}:`,
            ...ordered.map(
              ([name, tally]) =>
                `  ${name}: ${tally.open} open, ${tally.overdue} overdue, ${duration(tally.minutes) ?? '0m'} estimated`,
            ),
          ]),
        );
      }),
  );

  server.registerTool(
    'kernix_whats_late',
    {
      title: 'Everything overdue or blocked',
      description:
        'The single question a project manager asks most: what has slipped. Returns overdue and blocked work ' +
        'across every project, worst first, with who owns each item.',
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(40).describe('Maximum rows to return.'),
      },
    },
    async ({ limit }) =>
      guard(async () => {
        await vocab.load();
        const page = await client.get<{ data: Array<Record<string, unknown>> }>('/api/tasks', {
          view: 'all',
          per_page: 100,
          sort: 'due_date',
        });
        const now = new Date();
        const todayIso = today(now);

        const late = page.data.filter((row) => {
          const status = (row.status as { key_name?: string } | null)?.key_name;
          if (status === 'complete') return false;
          if (status === 'blocked') return true;
          const due = day(row.due_date as string);
          return Boolean(due && due < todayIso);
        });

        if (!late.length) return text('Nothing is overdue or blocked.');

        const sorted = late.sort((a, b) => String(a.due_date ?? '9999').localeCompare(String(b.due_date ?? '9999')));
        return text(
          bullets([
            `${late.length} overdue or blocked:`,
            ...sorted.slice(0, limit).map((row) => `  ${taskLine(row as never, now)}`),
            late.length > limit ? `  … ${late.length - limit} more` : null,
          ]),
        );
      }),
  );
}

/**
 * Which areas this account can actually open, named the way the tools are.
 * An assistant that knows a surface is closed asks about something else rather
 * than calling a tool that will refuse.
 */
function describeAccess(permissions: string[]): string {
  const areas: Array<[string, string]> = [
    ['tasks.view', 'tasks'],
    ['projects.view', 'projects'],
    ['clients.view', 'clients'],
    ['contacts.view', 'contacts'],
    ['forms.view', 'client intake'],
    ['messages.view', 'messages'],
    ['time.track', 'time'],
    ['users.view', 'people admin'],
  ];
  const open = areas.filter(([permission]) => permissions.includes(permission)).map(([, label]) => label);
  const closed = areas.filter(([permission]) => !permissions.includes(permission)).map(([, label]) => label);
  return `${open.join(', ') || 'nothing'}${closed.length ? ` · no access to ${closed.join(', ')}` : ''}`;
}

/** One line for the dashboard's own compact row shape. */
function summaryLine(row: Record<string, unknown>): string {
  const bits = [
    row.client ? `${row.client} / ${row.project}` : (row.project as string),
    (row.status as { label?: string } | null)?.label,
    (row.urgency as { label?: string } | null)?.label,
    row.note as string | undefined,
  ].filter(Boolean);
  return `#${row.id} ${row.title}${bits.length ? ` — ${bits.join(' · ')}` : ''}`;
}
