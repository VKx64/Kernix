import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { KernixClient } from './client.js';
import type { Config } from './config.js';
import { Vocabulary } from './vocabulary.js';
import type { ToolContext } from './tools/context.js';
import { registerOrientation } from './tools/orientation.js';
import { registerTasks } from './tools/tasks.js';
import { registerPortfolio } from './tools/portfolio.js';
import { registerOperations } from './tools/operations.js';

const INSTRUCTIONS = `Kernix is a production management system: clients own projects, projects own
tasks, and time is tracked against tasks.

Act as a project manager working inside it.

Start with kernix_whoami — it reports which account you are acting as, what that account may do,
and whether writing is enabled at all. If writes are disabled, only read tools exist and you
should say so rather than pretending an action was taken.

Status, urgency and type are named values, not numbers. Call kernix_vocabulary once and use the
names it returns. Assignees are usernames. Projects and clients may be given by name.

Prefer the shaped tools over raw filters: kernix_whats_late for slippage, kernix_workload for
capacity, kernix_pending_approvals for the decision queue. They answer the questions a project
manager actually asks and cost far less context than listing everything.

Before changing anything, read it. Before assigning work, check the person's workload. When a
write is refused, the refusal text explains the rule that blocked it — relay that rather than
retrying blindly.`;

export function buildServer(config: Config): McpServer {
  const server = new McpServer(
    { name: 'kernix', version: '1.0.0' },
    { instructions: INSTRUCTIONS },
  );

  const client = new KernixClient(config);
  const context: ToolContext = { server, client, vocab: new Vocabulary(client), config };

  // Each module registers its read tools unconditionally and returns early
  // before its write tools when writes are off, so a read-only deployment
  // does not merely refuse writes — it never advertises them.
  registerOrientation(context);
  registerPortfolio(context);
  registerTasks(context);
  registerOperations(context);

  return server;
}
