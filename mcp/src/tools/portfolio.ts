import { z } from 'zod';
import { unwrap } from '../client.js';
import { bullets, day, duration, listHeader } from '../format.js';
import { guard, text, type ToolContext } from './context.js';
import { resolveProjectId } from './tasks.js';

/**
 * Kernix derives one delivery-health value per project and rolls the worst one
 * up to the client. The API returns the key; these are the words the interface
 * puts beside it, so an assistant and a person reading the same screen agree.
 */
const HEALTH: Record<string, string> = {
  ontrack: 'on track',
  atrisk: 'at risk',
  offtrack: 'off track',
  done: 'done',
};

/** Clients, projects and the people on them. */
export function registerPortfolio({ server, client, vocab, config }: ToolContext): void {
  server.registerTool(
    'kernix_list_clients',
    {
      title: 'List clients',
      description:
        'Every client with its delivery health, retainer burn and open work. Use to answer "which accounts ' +
        'are in trouble" or "who is close to burning their retainer".',
      inputSchema: {
        search: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(50),
      },
    },
    async ({ search, limit }) =>
      guard(async () => {
        // `stats=1` is what unlocks health, retainer burn and the open/overdue
        // counts; without it the rows carry contact details and nothing a
        // project manager can act on.
        const page = await client.get<{
          data: Array<Record<string, unknown>>;
          meta?: { total: number; current_page: number; last_page: number };
        }>('/api/clients', { search, stats: 1, per_page: Math.min(limit, 100) });

        if (!page.data.length) return text('No clients match.');
        return text(
          bullets([
            listHeader('clients', page.data.length, page.meta),
            ...page.data.slice(0, limit).map((row) => {
              const stats = (row.stats ?? {}) as Record<string, number | string | null>;
              const bits: string[] = [];
              const status = (row.status as { label?: string } | null)?.label;
              if (status) bits.push(status);
              if (stats.health) bits.push(HEALTH[String(stats.health)] ?? String(stats.health));
              const allowance = duration(stats.retainer_minutes as number);
              bits.push(
                allowance
                  ? `retainer ${duration(stats.retainer_used_minutes as number) ?? '0m'} of ${allowance}`
                  : 'no retainer',
              );
              bits.push(`${stats.projects ?? row.projects_count ?? 0} projects`);
              if (stats.open_tasks !== undefined) bits.push(`${stats.open_tasks} open`);
              if (stats.overdue) bits.push(`${stats.overdue} overdue`);
              if (stats.blocked) bits.push(`${stats.blocked} blocked`);
              return `  #${row.id} ${row.name} — ${bits.join(' · ')}`;
            }),
          ]),
        );
      }),
  );

  server.registerTool(
    'kernix_list_projects',
    {
      title: 'List projects',
      description:
        'Projects with status, delivery health, budget burn and schedule. The starting point for a portfolio ' +
        'review or a status report.',
      inputSchema: {
        search: z.string().optional(),
        client: z.string().optional().describe('Limit to one client, by name.'),
        limit: z.number().int().min(1).max(200).default(50),
      },
    },
    async ({ search, client: clientName, limit }) =>
      guard(async () => {
        await vocab.load();
        const page = await client.get<{
          data: Array<Record<string, unknown>>;
          meta?: { total: number; current_page: number; last_page: number };
        }>('/api/projects', { search, stats: 1, per_page: Math.min(limit, 100) });

        let rows = page.data;
        if (clientName) {
          const wanted = clientName.toLowerCase();
          rows = rows.filter((row) =>
            String((row.client as { name?: string } | null)?.name ?? '').toLowerCase().includes(wanted),
          );
        }
        if (!rows.length) return text('No projects match.');

        return text(
          bullets([
            listHeader('projects', rows.length, clientName ? undefined : page.meta),
            ...rows.slice(0, limit).map((row) => {
              const stats = (row.stats ?? {}) as Record<string, number | string | null>;
              const bits: string[] = [];
              const owner = (row.client as { name?: string } | null)?.name;
              if (owner) bits.push(owner);
              const status = (row.status as { label?: string } | null)?.label;
              if (status) bits.push(status);
              if (stats.health) bits.push(HEALTH[String(stats.health)] ?? String(stats.health));
              if (stats.percent_complete !== undefined) bits.push(`${stats.percent_complete}% done`);
              const budget = duration((stats.budget_minutes ?? row.budget_minutes) as number);
              bits.push(
                budget ? `${duration(stats.logged_minutes as number) ?? '0m'} of ${budget}` : 'no budget',
              );
              if (stats.overdue) bits.push(`${stats.overdue} overdue`);
              if (stats.blocked) bits.push(`${stats.blocked} blocked`);
              const due = day(row.due_date as string);
              if (due) bits.push(`due ${due}`);
              const manager = (row.manager as { name?: string } | null)?.name;
              if (manager) bits.push(`PM ${manager}`);
              return `  #${row.id} ${row.name} — ${bits.join(' · ')}`;
            }),
          ]),
        );
      }),
  );

  server.registerTool(
    'kernix_get_project',
    {
      title: 'Read one project',
      description: 'A project in full: schedule, budget, team, folders and its task breakdown by status.',
      inputSchema: { project: z.string().describe('Project name or id.') },
    },
    async ({ project }) =>
      guard(async () => {
        await vocab.load();
        const id = await resolveProjectId(client, project);
        const row = unwrap(
          await client.get<{ data: Record<string, unknown> }>(`/api/projects/${id}`, { stats: 1 }),
        );
        const stats = (row.stats ?? {}) as Record<string, number | string | null>;

        const tasks = await client.get<{ data: Array<Record<string, unknown>> }>('/api/tasks', {
          project_id: id,
          view: 'all',
          per_page: 100,
        });
        const byStatus = new Map<string, number>();
        for (const task of tasks.data) {
          const label = (task.status as { label?: string } | null)?.label ?? 'unknown';
          byStatus.set(label, (byStatus.get(label) ?? 0) + 1);
        }

        const folders = unwrap(
          await client.get<{ data: Array<{ id: number; name: string }> }>(`/api/projects/${id}/task-folders`),
        ).map((folder) => folder.name);

        return text(
          bullets([
            `#${row.id} ${row.name}`,
            `  client: ${(row.client as { name?: string } | null)?.name ?? 'none'}`,
            `  status: ${(row.status as { label?: string } | null)?.label ?? 'unknown'}${stats.health ? ` · ${HEALTH[String(stats.health)] ?? stats.health}` : ''}`,
            `  schedule: ${day(row.start_date as string) ?? 'no start'} to ${day(row.due_date as string) ?? 'no due date'}`,
            `  budget: ${duration(stats.logged_minutes as number) ?? '0m'} logged of ${duration((stats.budget_minutes ?? row.budget_minutes) as number) ?? 'no budget'} (${duration(stats.estimated_minutes as number) ?? '0m'} estimated across ${stats.total ?? 0} tasks)`,
            `  progress: ${stats.percent_complete ?? 0}% · ${stats.open ?? 0} open · ${stats.overdue ?? 0} overdue · ${stats.blocked ?? 0} blocked · ${stats.unowned ?? 0} unassigned`,
            `  manager: ${(row.manager as { name?: string } | null)?.name ?? 'none'}`,
            folders.length ? `  folders: ${folders.join(', ')}` : null,
            `  tasks: ${[...byStatus.entries()].map(([label, count]) => `${count} ${label}`).join(', ') || 'none'}`,
            row.description ? `  description: ${row.description}` : null,
          ]),
        );
      }),
  );

  server.registerTool(
    'kernix_list_people',
    {
      title: 'List people',
      description: 'Everyone in the workspace with their role and department — the names other tools accept.',
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        const people = await vocab.people();
        if (!people.length) return text('No people visible to this account.');
        return text(
          bullets([
            `${people.length} people:`,
            ...people.map((person) => {
              const full = `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim();
              const role = person.role?.name ? ` · ${person.role.name}` : '';
              return `  @${person.username}${full ? ` (${full})` : ''}${role}`;
            }),
          ]),
        );
      }),
  );

  if (!config.allowWrites) return;

  server.registerTool(
    'kernix_create_project',
    {
      title: 'Create a project',
      description: 'Open a new project under a client.',
      inputSchema: {
        client: z.string().describe('Client name or id.'),
        name: z.string().max(191),
        description: z.string().optional(),
        status: z.string().optional().describe('planning, active, on_hold or complete.'),
        manager: z.string().optional().describe('Username of the project manager.'),
        start_date: z.string().optional().describe('YYYY-MM-DD.'),
        due_date: z.string().optional().describe('YYYY-MM-DD.'),
        budget_minutes: z.number().int().min(0).optional(),
      },
    },
    async (args) =>
      guard(async () => {
        const clients = unwrap(
          await client.get<{ data: Array<{ id: number; name: string }> }>('/api/clients', { per_page: 200 }),
        );
        const wanted = args.client.toLowerCase();
        const owner = /^\d+$/.test(args.client)
          ? clients.find((row) => row.id === Number(args.client))
          : clients.find((row) => row.name.toLowerCase() === wanted)
            ?? clients.find((row) => row.name.toLowerCase().includes(wanted));
        if (!owner) return text(`No client matches "${args.client}". Known: ${clients.map((c) => c.name).join(', ')}.`);

        const body: Record<string, unknown> = { client_id: owner.id, name: args.name };
        if (args.description) body.description = args.description;
        if (args.start_date) body.start_date = args.start_date;
        if (args.due_date) body.due_date = args.due_date;
        if (args.budget_minutes !== undefined) body.budget_minutes = args.budget_minutes;
        if (args.status) body.status_value_id = await vocab.idFor('project_status', args.status);
        if (args.manager) body.manager_user_id = await vocab.personId(args.manager);

        const created = unwrap(await client.post<{ data: Record<string, unknown> }>('/api/projects', body));
        return text(`Created project #${created.id} ${created.name} for ${owner.name}.`);
      }),
  );

  server.registerTool(
    'kernix_update_project',
    {
      title: 'Change a project',
      description: 'Update a project\'s status, schedule, budget, manager or description.',
      inputSchema: {
        project: z.string().describe('Project name or id.'),
        name: z.string().max(191).optional(),
        description: z.string().optional(),
        status: z.string().optional().describe('planning, active, on_hold or complete.'),
        manager: z.string().optional(),
        start_date: z.string().nullable().optional(),
        due_date: z.string().nullable().optional(),
        budget_minutes: z.number().int().min(0).nullable().optional(),
      },
    },
    async (args) =>
      guard(async () => {
        const id = await resolveProjectId(client, args.project);
        const body: Record<string, unknown> = {};
        if (args.name !== undefined) body.name = args.name;
        if (args.description !== undefined) body.description = args.description;
        if (args.start_date !== undefined) body.start_date = args.start_date;
        if (args.due_date !== undefined) body.due_date = args.due_date;
        if (args.budget_minutes !== undefined) body.budget_minutes = args.budget_minutes;
        if (args.status) body.status_value_id = await vocab.idFor('project_status', args.status);
        if (args.manager) body.manager_user_id = await vocab.personId(args.manager);
        if (!Object.keys(body).length) return text('Nothing to change — pass at least one field.');

        const updated = unwrap(await client.put<{ data: Record<string, unknown> }>(`/api/projects/${id}`, body));
        return text(`Updated project #${updated.id} ${updated.name}.`);
      }),
  );
}
