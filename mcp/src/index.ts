#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { loadConfig, type Config } from './config.js';
import { buildServer } from './server.js';

const config = loadConfig();

/**
 * stdio is what Claude Code and Claude Desktop spawn; HTTP is what a remote
 * client such as a ChatGPT connector needs, and what a shared deployment at a
 * single hostname serves. The tool surface is identical — the only differences
 * are how bytes arrive and where the Kernix credentials come from.
 */
async function main(): Promise<void> {
  if (config.transport === 'stdio') {
    const server = buildServer(config);
    await server.connect(new StdioServerTransport());
    console.error(
      `kernix-mcp ready on stdio · ${config.baseUrl} · writes ${config.allowWrites ? 'enabled' : 'disabled'}`,
    );
    return;
  }

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/healthz', (_request, response) => {
    response.json({
      ok: true,
      kernix: config.baseUrl,
      auth: config.tokenSource,
      writes: config.allowWrites,
    });
  });

  app.post('/mcp', async (request, response) => {
    const token = resolveToken(request, config);
    if (!token) {
      // 401 with a challenge, so an MCP client knows to prompt for credentials
      // rather than reporting the server as broken.
      response
        .status(401)
        .set('WWW-Authenticate', 'Bearer realm="Kernix"')
        .json({
          jsonrpc: '2.0',
          error: {
            code: -32001,
            message:
              'This endpoint needs a Kernix API token. Send it as "Authorization: Bearer <token>". ' +
              'Create one in Kernix under Settings → Workspace → AI assistant access.',
          },
          id: null,
        });
      return;
    }

    // Stateless, and one server instance per request: there is no session to
    // leak between callers, and — the reason this matters here — no chance of
    // one workspace's token being reused for another's request.
    const server = buildServer({ ...config, token });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    response.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      console.error('kernix-mcp: request failed', error);
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  // Streamable HTTP reserves GET and DELETE for session handling, which the
  // stateless mode does not use.
  const noSession = (_request: express.Request, response: express.Response) => {
    response.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed — this server is stateless.' },
      id: null,
    });
  };
  app.get('/mcp', noSession);
  app.delete('/mcp', noSession);

  app.listen(config.port, config.host, () => {
    const where = config.publicUrl ?? `http://${config.host}:${config.port}`;
    console.error(
      `kernix-mcp ready on ${where}/mcp · ${config.baseUrl} · ` +
        `auth ${config.tokenSource === 'request' ? 'per request' : 'from environment'} · ` +
        `writes ${config.allowWrites ? 'enabled' : 'disabled'}`,
    );
  });
}

/**
 * The caller's own token wins over the process-wide one. That ordering is what
 * lets a single deployment serve many workspaces while a developer running the
 * same binary locally can still set one token and skip the header.
 */
function resolveToken(request: express.Request, settings: Config): string | null {
  const header = request.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (match?.[1]) return match[1].trim();
  if (settings.tokenSource === 'env' && settings.token) return settings.token;
  return null;
}

main().catch((error) => {
  console.error('kernix-mcp: failed to start', error);
  process.exit(1);
});
