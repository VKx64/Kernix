import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from '../config.js';
import type { KernixClient } from '../client.js';
import { KernixError } from '../client.js';
import type { Vocabulary } from '../vocabulary.js';

export interface ToolContext {
  server: McpServer;
  client: KernixClient;
  vocab: Vocabulary;
  config: Config;
}

export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

export function text(body: string): ToolResult {
  return { content: [{ type: 'text', text: body }] };
}

/**
 * Every tool runs inside this. A thrown `KernixError` becomes a readable tool
 * error rather than a transport-level failure, which matters because an
 * assistant can recover from "that status does not exist, valid options are X"
 * but not from a dropped connection.
 */
export async function guard(run: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await run();
  } catch (error) {
    const body = error instanceof KernixError
      ? error.toText()
      : error instanceof Error
        ? error.message
        : String(error);
    return { content: [{ type: 'text', text: body }], isError: true };
  }
}

/**
 * Kernix pages at 25 by default. A project manager asking "what is overdue"
 * wants the whole answer, so reads walk pages up to a ceiling that keeps a
 * runaway query from filling the context window.
 */
export async function collect<T>(
  fetchPage: (page: number) => Promise<{ data: T[]; meta?: { current_page: number; last_page: number; total: number } }>,
  limit: number,
): Promise<{ rows: T[]; meta?: { current_page: number; last_page: number; total: number } }> {
  const rows: T[] = [];
  let meta: { current_page: number; last_page: number; total: number } | undefined;
  let page = 1;

  while (rows.length < limit) {
    const result = await fetchPage(page);
    meta = result.meta;
    rows.push(...result.data);
    if (!meta || meta.current_page >= meta.last_page || result.data.length === 0) break;
    page += 1;
  }

  return { rows: rows.slice(0, limit), meta };
}
