import { z } from 'zod';
import { unwrap } from '../client.js';
import { bullets, duration, listHeader, taskDetail, taskLine } from '../format.js';
import { guard, text, type ToolContext } from './context.js';

/** The task surface: the bulk of what a project manager touches. */
export function registerTasks({ server, client, vocab, config }: ToolContext): void {
  /**
   * Kernix gates task changes on an open work session. When the operator has
   * opted into administrator override, every task write carries the flag; the
   * API still ignores it for non-administrators, so this cannot grant more than
   * the account already has.
   */
  const withGate = (body: Record<string, unknown>): Record<string, unknown> =>
    config.adminOverride ? { ...body, admin_override: true } : body;

  server.registerTool(
    'kernix_list_tasks',
    {
      title: 'Find tasks',
      description:
        'Search and filter tasks. Status, urgency and type are given by name (see kernix_vocabulary); ' +
        'assignee is a username. Returns one line per task with its id, which other tools take.',
      inputSchema: {
        view: z
          .enum(['triage', 'mine', 'all', 'unassigned', 'done'])
          .optional()
          .describe('Kernix\'s own saved views. "triage" is what needs attention; "all" is everything open.'),
        search: z.string().optional().describe('Matches task title or project name.'),
        project: z.string().optional().describe('Project name or id.'),
        assignee: z.string().optional().describe('Username, full name, or "none" for unassigned.'),
        status: z.string().optional().describe('Status name, e.g. in_progress, blocked, quality_check.'),
        urgency: z.string().optional().describe('Urgency name, e.g. urgent, high, normal, low.'),
        type: z.string().optional().describe('Type name, e.g. task, bug, feature, request.'),
        urgent_only: z.boolean().optional().describe('Only urgent and high urgency.'),
        limit: z.number().int().min(1).max(200).default(50).describe('Maximum tasks to return.'),
      },
    },
    async (args) =>
      guard(async () => {
        // Loading the vocabulary first also settles the workspace timezone,
        // without which every due date renders a day out.
        await vocab.load();
        const query: Record<string, string | number | boolean> = {
          per_page: Math.min(args.limit, 100),
        };
        if (args.view) query.view = args.view;
        if (args.search) query.search = args.search;
        if (args.urgent_only) query.urgent = true;
        if (args.status) query.status_value_id = await vocab.idFor('task_status', args.status);
        if (args.urgency) query.urgency_value_id = await vocab.idFor('task_urgency', args.urgency);
        if (args.type) query.type_value_id = await vocab.idFor('task_type', args.type);
        if (args.assignee) {
          query.assignee_user_id =
            args.assignee.toLowerCase() === 'none' ? 'none' : await vocab.personId(args.assignee);
        }
        if (args.project) query.project_id = await resolveProjectId(client, args.project);

        const page = await client.get<{
          data: Array<Record<string, unknown>>;
          meta?: { total: number; current_page: number; last_page: number };
        }>('/api/tasks', query);

        if (!page.data.length) return text('No tasks match those filters.');
        const today = new Date();
        return text(
          bullets([
            listHeader('tasks', page.data.length, page.meta),
            ...page.data.slice(0, args.limit).map((row) => `  ${taskLine(row as never, today)}`),
          ]),
        );
      }),
  );

  server.registerTool(
    'kernix_get_task',
    {
      title: 'Read one task in full',
      description:
        'Everything about a task: description, status, assignees, time, subtasks and the discussion. ' +
        'Use before changing a task so the change is informed.',
      inputSchema: {
        task_id: z.number().int().positive(),
        include_notes: z.boolean().default(true).describe('Include the discussion thread.'),
      },
    },
    async ({ task_id, include_notes }) =>
      guard(async () => {
        await vocab.load();
        const task = unwrap(await client.get<{ data: Record<string, unknown> }>(`/api/tasks/${task_id}`));
        const sections = [taskDetail(task as never)];

        const subtasks = task.subtasks as Array<Record<string, unknown>> | undefined;
        if (subtasks?.length) {
          sections.push(
            bullets([
              '  subtasks:',
              ...subtasks.map((sub) => {
                const done = sub.completed_at ? 'x' : ' ';
                return `    [${done}] #${sub.id} ${sub.title} (${duration(sub.actual_minutes as number) ?? '0m'} of ${duration(sub.estimated_minutes as number) ?? 'no estimate'})`;
              }),
            ]),
          );
        }

        if (include_notes) {
          // The task payload already carries its notes; there is no GET on the
          // notes route, only a POST to add one.
          const notes = ((task.notes as Array<Record<string, unknown>>) ?? []).filter(
            (note) => !note.is_message,
          );
          if (notes.length) {
            sections.push(
              bullets([
                '  notes:',
                ...notes.map((note) => {
                  const author = (note.author as { name?: string } | null)?.name ?? 'unknown';
                  const when = String(note.created_at ?? '').slice(0, 10);
                  const logged = note.time_minutes ? ` (+${duration(note.time_minutes as number)})` : '';
                  return `    ${when} ${author}${logged}: ${String(note.body ?? '').replace(/\n/g, ' ')}`;
                }),
              ]),
            );
          }
        }

        return text(sections.join('\n'));
      }),
  );

  if (!config.allowWrites) return;

  server.registerTool(
    'kernix_create_task',
    {
      title: 'Create a task',
      description:
        'Add a task to a project. Status, urgency and type take names, not ids. Assignees take usernames; ' +
        'leaving them out assigns the project manager, which is Kernix\'s own default.',
      inputSchema: {
        project: z.string().describe('Project name or id.'),
        title: z.string().max(255),
        description: z.string().optional(),
        assignees: z.array(z.string()).optional().describe('Usernames or full names.'),
        urgency: z.string().optional().describe('urgent, high, normal or low.'),
        type: z.string().optional().describe('task, bug, feature or request.'),
        due_date: z.string().optional().describe('YYYY-MM-DD.'),
        estimated_minutes: z.number().int().min(0).max(1_000_000).optional(),
        subtasks: z.array(z.string()).max(50).optional().describe('Checklist titles.'),
      },
    },
    async (args) =>
      guard(async () => {
        const body: Record<string, unknown> = {
          project_id: await resolveProjectId(client, args.project),
          title: args.title,
        };
        if (args.description) body.description = args.description;
        if (args.due_date) body.due_date = args.due_date;
        if (args.estimated_minutes !== undefined) body.estimated_minutes = args.estimated_minutes;
        if (args.urgency) body.urgency_value_id = await vocab.idFor('task_urgency', args.urgency);
        if (args.type) body.type_value_id = await vocab.idFor('task_type', args.type);
        if (args.assignees?.length) {
          body.assignee_user_ids = await Promise.all(args.assignees.map((who) => vocab.personId(who)));
        }
        if (args.subtasks?.length) body.subtasks = args.subtasks.map((title) => ({ title }));

        const task = unwrap(await client.post<{ data: Record<string, unknown> }>('/api/tasks', withGate(body)));
        return text(`Created:\n${taskDetail(task as never)}`);
      }),
  );

  server.registerTool(
    'kernix_update_task',
    {
      title: 'Change a task',
      description:
        'Update any of a task\'s fields — status, urgency, assignees, due date, estimate, title, description. ' +
        'Only the fields you pass are changed. Note that Kernix may refuse a move to complete until a ' +
        'completion proof exists; the refusal message says so.',
      inputSchema: {
        task_id: z.number().int().positive(),
        title: z.string().max(255).optional(),
        description: z.string().optional(),
        status: z.string().optional().describe('Status name, e.g. in_progress, blocked, quality_check.'),
        urgency: z.string().optional(),
        type: z.string().optional(),
        due_date: z.string().nullable().optional().describe('YYYY-MM-DD, or null to clear.'),
        estimated_minutes: z.number().int().min(0).max(1_000_000).optional(),
        assignees: z.array(z.string()).optional().describe('Replaces the current assignee list.'),
        project: z.string().optional().describe('Move to another project, by name or id.'),
      },
    },
    async (args) =>
      guard(async () => {
        const body: Record<string, unknown> = {};
        if (args.title !== undefined) body.title = args.title;
        if (args.description !== undefined) body.description = args.description;
        if (args.due_date !== undefined) body.due_date = args.due_date;
        if (args.estimated_minutes !== undefined) body.estimated_minutes = args.estimated_minutes;
        if (args.status) body.status_value_id = await vocab.idFor('task_status', args.status);
        if (args.urgency) body.urgency_value_id = await vocab.idFor('task_urgency', args.urgency);
        if (args.type) body.type_value_id = await vocab.idFor('task_type', args.type);
        if (args.project) body.project_id = await resolveProjectId(client, args.project);
        if (args.assignees) {
          body.assignee_user_ids = await Promise.all(args.assignees.map((who) => vocab.personId(who)));
        }
        if (!Object.keys(body).length) return text('Nothing to change — pass at least one field.');

        const task = unwrap(
          await client.put<{ data: Record<string, unknown> }>(`/api/tasks/${args.task_id}`, withGate(body)),
        );
        return text(`Updated:\n${taskDetail(task as never)}`);
      }),
  );

  server.registerTool(
    'kernix_comment_on_task',
    {
      title: 'Add a note to a task',
      description:
        'Post an update to a task\'s discussion, optionally logging time against it. This is how a project ' +
        'manager leaves context on a task without changing its state.',
      inputSchema: {
        task_id: z.number().int().positive(),
        body: z.string().min(1).describe('The note text.'),
        time_minutes: z.number().int().min(0).max(1440).optional().describe('Minutes of work to log alongside the note.'),
      },
    },
    async ({ task_id, body, time_minutes }) =>
      guard(async () => {
        const payload: Record<string, unknown> = { body };
        if (time_minutes) payload.time_minutes = time_minutes;
        await client.post(`/api/tasks/${task_id}/notes`, withGate(payload));
        const logged = time_minutes ? ` and logged ${duration(time_minutes)}` : '';
        return text(`Added a note to task #${task_id}${logged}.`);
      }),
  );

  server.registerTool(
    'kernix_add_subtask',
    {
      title: 'Add a subtask',
      description: 'Append a checklist item to a task.',
      inputSchema: {
        task_id: z.number().int().positive(),
        title: z.string().max(255),
        assignee: z.string().optional().describe('Username or full name.'),
        estimated_minutes: z.number().int().min(0).optional(),
      },
    },
    async ({ task_id, title, assignee, estimated_minutes }) =>
      guard(async () => {
        const body: Record<string, unknown> = { title };
        if (assignee) body.assignee_user_id = await vocab.personId(assignee);
        if (estimated_minutes !== undefined) body.estimated_minutes = estimated_minutes;
        await client.post(`/api/tasks/${task_id}/subtasks`, withGate(body));
        return text(`Added subtask "${title}" to task #${task_id}.`);
      }),
  );
}

/** Shared by several tools: accept a project by name or id. */
export async function resolveProjectId(
  client: { get: <T>(path: string, query?: Record<string, string | number | boolean>) => Promise<T> },
  project: string,
): Promise<number> {
  if (/^\d+$/.test(project)) return Number(project);
  const projects = unwrap(
    await client.get<{ data: Array<{ id: number; name: string }> }>('/api/projects', { per_page: 200 }),
  );
  const wanted = project.toLowerCase();
  const exact = projects.find((p) => p.name.toLowerCase() === wanted);
  const partial = projects.filter((p) => p.name.toLowerCase().includes(wanted));
  const found = exact ?? (partial.length === 1 ? partial[0] : undefined);
  if (found) return found.id;

  if (partial.length > 1) {
    throw new Error(`"${project}" matches several projects: ${partial.map((p) => p.name).join(', ')}. Be more specific.`);
  }
  throw new Error(`No project matches "${project}". Known: ${projects.map((p) => p.name).join(', ')}.`);
}
