import { z } from 'zod';
import { isForbidden, unwrap } from '../client.js';
import { bullets, day, duration } from '../format.js';
import { guard, text, type ToolContext } from './context.js';

/**
 * The queues a project manager clears: approvals waiting on a decision, intake
 * waiting on triage, messages waiting on a reply, and the time record behind
 * all of it.
 */
export function registerOperations({ server, client, vocab, config }: ToolContext): void {
  // Starting or replying to a message counts as task work to Kernix, so these
  // pass through the same clock gate as a task edit.
  const withGate = (body: Record<string, unknown>): Record<string, unknown> =>
    config.adminOverride ? { ...body, admin_override: true } : body;

  server.registerTool(
    'kernix_pending_approvals',
    {
      title: 'Everything waiting on a decision',
      description:
        'Estimate requests and work requests still pending, across every task. This is the queue a project ' +
        'manager is expected to clear; each row carries the ids the decision tools need.',
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        const lines: string[] = [];

        // Each half of this queue is behind its own permission. A role that
        // holds one and not the other should still get the half it can act on.
        let work: Array<Record<string, unknown>> = [];
        try {
          work = unwrap(
            await client.get<{ data: Array<Record<string, unknown>> }>('/api/task-work-requests/pending'),
          );
          lines.push(`Work requests pending: ${work.length}`);
          for (const row of work) {
            const task = row.task as { id?: number; title?: string } | null;
            const who = (row.requester as { name?: string } | null)?.name ?? 'someone';
            lines.push(`  request #${row.id} on task #${task?.id} "${task?.title}" — ${who}: ${row.reason}`);
          }
        } catch (error) {
          if (!isForbidden(error)) throw error;
          lines.push('Work requests: not visible to this account.');
        }

        // Estimate requests have no workspace-wide index and the task list
        // carries no flag for them, so the only way to find them is to ask each
        // task. Completed tasks are skipped and the scan is capped, because an
        // unbounded fan-out over a large workspace would be far slower than the
        // answer is worth. The cap is reported rather than hidden.
        const tasks = await client.get<{ data: Array<Record<string, unknown>> }>('/api/tasks', {
          view: 'all',
          per_page: 100,
        });
        const open = tasks.data.filter(
          (task) => (task.status as { key_name?: string } | null)?.key_name !== 'complete',
        );
        const SCAN_LIMIT = 60;
        const scanned = open.slice(0, SCAN_LIMIT);

        const estimates: string[] = [];
        let refused = 0;
        for (const batch of chunk(scanned, 6)) {
          const results = await Promise.all(
            batch.map(async (task) => {
              try {
                return {
                  task,
                  rows: unwrap(
                    await client.get<{ data: Array<Record<string, unknown>> }>(
                      `/api/tasks/${task.id}/estimate-requests`,
                    ),
                  ),
                };
              } catch (error) {
                // A task this account may not review is not an error worth
                // failing the whole sweep over — it is simply not theirs.
                if (!isForbidden(error)) throw error;
                refused += 1;
                return { task, rows: [] as Array<Record<string, unknown>> };
              }
            }),
          );
          for (const { task, rows } of results) {
            for (const row of rows.filter((candidate) => candidate.status === 'pending')) {
              const waiting = row.ai_state === 'waiting_employee' ? ' [waiting on the employee to answer]' : '';
              estimates.push(
                `  request #${row.id} on task #${task.id} "${task.title}" — +${duration(row.requested_additional_minutes as number)} on top of ${duration(row.base_estimated_minutes as number) ?? 'no estimate'}${waiting}\n      reason: ${row.request_reason}`,
              );
            }
          }
        }

        lines.push('', `Estimate requests pending: ${estimates.length}`, ...estimates);
        if (refused) {
          lines.push(`  (${refused} of ${scanned.length} tasks were not visible to this account)`);
        }
        if (open.length > SCAN_LIMIT) {
          lines.push(
            `  (scanned the first ${SCAN_LIMIT} of ${open.length} open tasks — there may be more)`,
          );
        }

        return text(bullets(lines));
      }),
  );

  server.registerTool(
    'kernix_list_submissions',
    {
      title: 'Client intake awaiting review',
      description:
        'Form submissions sent in by clients that have not yet been turned into tasks or declined. ' +
        'Each row carries the submission id the convert and decline tools take.',
      inputSchema: {
        project: z.string().optional().describe('Limit to one project, by name or id.'),
        status: z.enum(['new', 'converted', 'declined']).default('new'),
      },
    },
    async ({ project, status }) =>
      guard(async () => {
        await vocab.load();
        const projects = unwrap(
          await client.get<{ data: Array<{ id: number; name: string }> }>('/api/projects', { per_page: 200 }),
        );
        const wanted = project?.toLowerCase();
        const scope = wanted
          ? projects.filter((row) => String(row.id) === wanted || row.name.toLowerCase().includes(wanted))
          : projects;
        if (!scope.length) return text(`No project matches "${project}".`);

        const lines: string[] = [];
        let count = 0;
        let refused = 0;
        for (const target of scope) {
          let forms: Array<{ id: number; title: string }> = [];
          try {
            forms = unwrap(
              await client.get<{ data: Array<{ id: number; title: string }> }>(`/api/projects/${target.id}/forms`),
            );
          } catch (error) {
            // Intake is behind its own permission, and a role that cannot see
            // one project's forms may still see another's.
            if (!isForbidden(error)) throw error;
            refused += 1;
            continue;
          }
          for (const form of forms) {
            const submissions = unwrap(
              await client.get<{ data: Array<Record<string, unknown>> }>(
                `/api/project-forms/${form.id}/submissions`,
                { status },
              ),
            );
            for (const row of submissions) {
              count += 1;
              const from = row.from_name ?? row.from_email ?? 'anonymous';
              const summary = firstAnswer(row);
              lines.push(
                `  submission #${row.id} (${row.reference}) — ${target.name} / ${form.title} · from ${from} · ${day(row.created_at as string)}\n      ${summary}`,
              );
            }
          }
        }

        if (refused === scope.length) {
          return text('Client intake is not visible to this account — it needs the forms.view permission.');
        }
        return text(
          bullets([
            `${count} ${status} submissions:`,
            ...lines,
            refused ? `  (${refused} of ${scope.length} projects were not visible to this account)` : null,
          ]),
        );
      }),
  );

  server.registerTool(
    'kernix_timesheet',
    {
      title: 'Read a timesheet',
      description:
        'Logged time for a period, grouped by client. Use to check what a person actually worked on, or to ' +
        'reconcile tracked time against a retainer.',
      inputSchema: {
        from: z.string().optional().describe('YYYY-MM-DD, defaults to the current period.'),
        to: z.string().optional().describe('YYYY-MM-DD.'),
      },
    },
    async ({ from, to }) =>
      guard(async () => {
        await vocab.load();
        const sheet = unwrap(
          await client.get<{ data: Record<string, unknown> }>('/api/timesheet', { from, to }),
        );
        const rows = (sheet.rows ?? sheet.entries) as Array<Record<string, unknown>> | undefined;
        if (!rows?.length) return text('Nothing tracked in that period.');

        const total = rows.reduce((sum, row) => sum + Number(row.minutes ?? 0), 0);
        return text(
          bullets([
            `${rows.length} entries, ${duration(total)} total`,
            ...rows.map(
              (row) =>
                `  ${day(row.work_date as string) ?? '?'} · ${row.client_name ?? '—'} · ${row.task_title ?? '—'} · ${duration(row.minutes as number) ?? '0m'}${row.description ? ` — ${row.description}` : ''}`,
            ),
          ]),
        );
      }),
  );

  server.registerTool(
    'kernix_clock_state',
    {
      title: 'Is this account clocked in',
      description:
        'Kernix refuses task changes unless the acting account has an open work session. This reports that ' +
        'state. If a task write is refused with "Clock in before changing task work", check here first.',
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        const timer = unwrap(await client.get<{ data: Record<string, unknown> }>('/api/time/timer'));
        const session = timer.session as Record<string, unknown> | null;
        const active = timer.entry as Record<string, unknown> | null;
        const timerLine = active
          ? `Timer running on task #${active.task_id} since ${String(active.started_at ?? '').slice(11, 16)} UTC`
          : 'No timer running.';
        return text(
          bullets([
            session
              ? `Clocked in since ${String(session.clock_in_at ?? '').slice(0, 16).replace('T', ' ')} UTC`
              : config.adminOverride
                ? 'Clocked out — but admin override is on, so task changes are still allowed.'
                : 'Clocked out — task changes will be refused. Use kernix_clock_in first.',
            timerLine,
            !session && active
              ? 'Note: a timer is still running against a work session that has since been closed.'
              : null,
            `Admin override: ${config.adminOverride ? 'enabled — task writes bypass the clock gate' : 'disabled'}`,
          ]),
        );
      }),
  );

  server.registerTool(
    'kernix_who_is_working',
    {
      title: 'Who is on the clock',
      description: 'People currently clocked in, with what they are tracking against right now.',
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        const rows = unwrap(
          await client.get<{ data: Array<Record<string, unknown>> }>('/api/time/clocked-users'),
        );
        if (!rows.length) return text('Nobody is clocked in.');
        return text(
          bullets([
            `${rows.length} clocked in:`,
            ...rows.map((row) => {
              const user = row.user as Record<string, string> | null;
              const name = user
                ? `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || user.username
                : 'someone';
              const task = (row.task as { title?: string } | null)?.title;
              const since = row.clock_in_at ? ` since ${String(row.clock_in_at).slice(11, 16)} UTC` : '';
              const note = row.notes ? ` (${row.notes})` : '';
              return `  ${name}${since}${task ? ` — ${task}` : ' — no active timer'}${note}`;
            }),
          ]),
        );
      }),
  );

  server.registerTool(
    'kernix_list_messages',
    {
      title: 'Message threads',
      description:
        'Conversations involving this account. Defaults to unread, which is the queue worth clearing.',
      inputSchema: {
        filter: z.enum(['unread', 'all']).default('unread'),
        limit: z.number().int().min(1).max(50).default(20),
      },
    },
    async ({ filter, limit }) =>
      guard(async () => {
        const page = await client.get<{
          data: Array<Record<string, unknown>>;
          meta?: { total: number };
        }>('/api/messages', { filter, per_page: limit });
        if (!page.data.length) return text(filter === 'unread' ? 'No unread messages.' : 'No messages.');

        return text(
          bullets([
            `${page.meta?.total ?? page.data.length} ${filter} conversations:`,
            ...page.data.map((row) => {
              const task = (row.task as { id?: number; title?: string } | null)?.title;
              const last = String(row.preview ?? row.body ?? '').replace(/\n/g, ' ').slice(0, 120);
              const unread = row.unread_count ? ` · ${row.unread_count} unread` : '';
              return `  thread #${row.id}${task ? ` on "${task}"` : ''}${unread}\n      ${last}`;
            }),
          ]),
        );
      }),
  );

  if (!config.allowWrites) return;

  server.registerTool(
    'kernix_clock_in',
    {
      title: 'Clock this account in',
      description:
        'Open a work session for the account this server acts as, which is what Kernix requires before task ' +
        'changes are allowed. This records real attendance against the account — only do it when the person ' +
        'behind the account has asked you to, and clock out when the work is done.',
      inputSchema: {
        notes: z.string().optional().describe('Optional note stored on the session.'),
      },
    },
    async ({ notes }) =>
      guard(async () => {
        const session = unwrap(
          await client.post<{ data: Record<string, unknown> }>('/api/time/clock-in', notes ? { notes } : {}),
        );
        return text(`Clocked in at ${String(session.clock_in_at ?? '').slice(0, 16).replace('T', ' ')} UTC.`);
      }),
  );

  server.registerTool(
    'kernix_clock_out',
    {
      title: 'Clock this account out',
      description: 'Close the work session opened by kernix_clock_in.',
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        await client.post('/api/time/clock-out', {});
        return text('Clocked out.');
      }),
  );

  server.registerTool(
    'kernix_decide_estimate_request',
    {
      title: 'Approve or reject an estimate request',
      description:
        'Rule on an employee\'s request for more time on a task. Approving without minutes grants the full ' +
        'amount requested.',
      inputSchema: {
        task_id: z.number().int().positive(),
        request_id: z.number().int().positive(),
        decision: z.enum(['approve', 'reject']),
        reason: z.string().min(1).describe('Shown to the person who asked. Say why.'),
        approved_minutes: z.number().int().min(0).optional().describe('Grant less than requested.'),
      },
    },
    async ({ task_id, request_id, decision, reason, approved_minutes }) =>
      guard(async () => {
        const body: Record<string, unknown> = { reason };
        if (decision === 'approve' && approved_minutes !== undefined) {
          body.approved_additional_minutes = approved_minutes;
        }
        await client.post(`/api/tasks/${task_id}/estimate-requests/${request_id}/${decision}`, withGate(body));
        return text(`Estimate request #${request_id} on task #${task_id} ${decision === 'approve' ? 'approved' : 'rejected'}.`);
      }),
  );

  server.registerTool(
    'kernix_decide_work_request',
    {
      title: 'Approve or decline a work request',
      description: 'Rule on somebody asking to pick up a task they are not assigned to.',
      inputSchema: {
        task_id: z.number().int().positive(),
        request_id: z.number().int().positive(),
        decision: z.enum(['approve', 'decline']),
        reason: z.string().optional().describe('Shown to the requester.'),
      },
    },
    async ({ task_id, request_id, decision, reason }) =>
      guard(async () => {
        await client.post(
          `/api/tasks/${task_id}/work-requests/${request_id}/${decision}`,
          withGate(reason ? { decision_reason: reason } : {}),
        );
        return text(`Work request #${request_id} on task #${task_id} ${decision}d.`);
      }),
  );

  server.registerTool(
    'kernix_convert_submission',
    {
      title: 'Turn a client submission into a task',
      description: 'Accept an intake submission, creating the task it describes.',
      inputSchema: {
        submission_id: z.number().int().positive(),
        assignee: z.string().optional().describe('Username to assign the new task to.'),
        urgency: z.string().optional().describe('Override the urgency the form supplied.'),
      },
    },
    async ({ submission_id, assignee, urgency }) =>
      guard(async () => {
        const body: Record<string, unknown> = {};
        if (assignee) body.assignee_user_id = await vocab.personId(assignee);
        if (urgency) body.urgency_value_id = await vocab.idFor('task_urgency', urgency);
        const created = unwrap(
          await client.post<{ data: Record<string, unknown> }>(
            `/api/form-submissions/${submission_id}/convert`,
            withGate(body),
          ),
        );
        const task = (created.task ?? created) as { id?: number; title?: string };
        return text(`Submission #${submission_id} converted to task #${task.id} "${task.title}".`);
      }),
  );

  server.registerTool(
    'kernix_decline_submission',
    {
      title: 'Decline a client submission',
      description: 'Reject an intake submission with a reason, without creating a task.',
      inputSchema: {
        submission_id: z.number().int().positive(),
        reason: z.string().min(1).describe('Why it was declined.'),
      },
    },
    async ({ submission_id, reason }) =>
      guard(async () => {
        await client.post(`/api/form-submissions/${submission_id}/decline`, withGate({ decline_reason: reason }));
        return text(`Submission #${submission_id} declined.`);
      }),
  );

  server.registerTool(
    'kernix_send_message',
    {
      title: 'Message someone about a task',
      description:
        'Open a conversation with a colleague about a specific task. Use to chase an owner or hand work over.',
      inputSchema: {
        task_id: z.number().int().positive(),
        to: z.string().describe('Username or full name of the recipient.'),
        body: z.string().min(1),
      },
    },
    async ({ task_id, to, body }) =>
      guard(async () => {
        const recipient = await vocab.personId(to);
        await client.post('/api/messages', withGate({ task_id, recipient_id: recipient, body }));
        return text(`Message sent to ${to} about task #${task_id}.`);
      }),
  );

  server.registerTool(
    'kernix_reply_message',
    {
      title: 'Reply in a thread',
      description: 'Post a reply into an existing conversation.',
      inputSchema: {
        thread_id: z.number().int().positive(),
        body: z.string().min(1),
      },
    },
    async ({ thread_id, body }) =>
      guard(async () => {
        await client.post(`/api/messages/${thread_id}/replies`, withGate({ body }));
        return text(`Replied in thread #${thread_id}.`);
      }),
  );
}

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < rows.length; index += size) out.push(rows.slice(index, index + size));
  return out;
}

function firstAnswer(submission: Record<string, unknown>): string {
  const answers = submission.answers as Record<string, unknown> | undefined;
  const snapshot = submission.form_snapshot as { fields?: Array<{ id: string; maps?: string }> } | undefined;
  const titleField = snapshot?.fields?.find((field) => field.maps === 'title');
  const value = titleField && answers ? answers[titleField.id] : undefined;
  if (typeof value === 'string') return value;
  const first = answers ? Object.values(answers).find((entry) => typeof entry === 'string') : undefined;
  return typeof first === 'string' ? first : '(no summary)';
}
