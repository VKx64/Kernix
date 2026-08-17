/**
 * Every knob the server reads, resolved once at start-up so a misconfiguration
 * fails immediately with a message a human can act on rather than surfacing as
 * a 401 on the first tool call.
 */
export interface Config {
  /** Origin of the Kernix API, without a trailing slash. */
  baseUrl: string;
  /**
   * Sanctum personal access token carrying the `web-api` ability.
   *
   * Empty in hosted mode, where each caller presents their own token on the
   * request instead. See `tokenSource`.
   */
  token: string;
  /**
   * Where a request's Kernix credentials come from.
   *
   * `env` — one token for the whole process, read from the environment. This is
   * the local and desktop case: the client spawns the server, so the process
   * belongs to exactly one person in exactly one workspace.
   *
   * `request` — every caller presents their own bearer token. This is what
   * makes a single deployment at one hostname serve every workspace: the token
   * identifies the account, and Kernix scopes everything it returns to that
   * account's active workspace. The server holds no workspace state of its own.
   */
  tokenSource: 'env' | 'request';
  /** Transport to serve on. */
  transport: 'stdio' | 'http';
  /** HTTP mode only. */
  host: string;
  port: number;
  /** Public origin this deployment answers on, used in setup instructions. */
  publicUrl: string | null;
  /**
   * Where the Kernix web app lives, as a person's browser reaches it.
   *
   * The authorization flow hands the browser to Kernix to sign in and approve,
   * so this is the one address the MCP server needs that is not the API.
   */
  appUrl: string;
  /**
   * Seals the authorization flow's client registrations and codes.
   *
   * It has to be the same value after a restart, or every connector that has
   * already registered stops being recognised. Empty turns the flow off rather
   * than inventing a value that would not survive the next restart.
   */
  oauthSecret: string;
  /**
   * Tools that write are opt-in. A project manager that can only read is a
   * useful and much safer default, and an assistant cannot talk its way past
   * this because the tools are never registered in the first place.
   *
   * This is a ceiling, not a grant: Kernix still applies the account's own
   * permissions to every call.
   */
  allowWrites: boolean;
  /**
   * Kernix refuses task changes unless the acting person is clocked in, which
   * is a rule about human work sessions that an automation cannot satisfy
   * honestly. An administrator may pass `admin_override` to bypass it. Off by
   * default: the alternative — having the assistant clock the account in — is
   * the truthful path, and this flag should be a deliberate choice.
   */
  adminOverride: boolean;
  /** Seconds before an API call is abandoned. */
  timeoutSeconds: number;
}

function fail(message: string): never {
  // stdout belongs to the JSON-RPC stream; diagnostics go to stderr.
  console.error(`kernix-mcp: ${message}`);
  process.exit(1);
}

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

export const MINT_TOKEN_HINT =
  'Mint one in Kernix under Settings → Workspace → AI assistant access, or from the shell:\n' +
  "  docker compose exec backend php artisan tinker --execute=\"echo App\\\\Models\\\\User::where('username','admin')->firstOrFail()->createToken('MCP', ['web-api'])->plainTextToken;\"";

export function loadConfig(argv: string[] = process.argv.slice(2)): Config {
  const baseUrl = (process.env.KERNIX_BASE_URL ?? 'http://localhost:8000').replace(/\/+$/, '');
  const token = process.env.KERNIX_API_TOKEN ?? '';
  const transport = argv.includes('--http') || envFlag('KERNIX_MCP_HTTP', false) ? 'http' : 'stdio';

  if (!/^https?:\/\//.test(baseUrl)) {
    fail(`KERNIX_BASE_URL must start with http:// or https:// (received "${baseUrl}").`);
  }

  // Hosted deployments take the token from each request. Anything else needs
  // one in the environment, because there is nowhere else for it to come from.
  const hosted = envFlag('KERNIX_MCP_HOSTED', false) || (transport === 'http' && !token);
  const tokenSource: Config['tokenSource'] = hosted ? 'request' : 'env';

  if (tokenSource === 'env' && !token) {
    fail(`KERNIX_API_TOKEN is not set.\n${MINT_TOKEN_HINT}`);
  }
  if (hosted && transport === 'stdio') {
    fail('KERNIX_MCP_HOSTED only applies to the HTTP transport. Add --http, or set KERNIX_API_TOKEN instead.');
  }

  // `PORT` is what a managed host hands the process — cPanel's Node.js App
  // (Passenger), Heroku, Fly and the rest all set it and expect the app to
  // listen there. An explicit `KERNIX_MCP_PORT` still wins, so a local run can
  // pin its own port without the host's value getting in the way.
  const portSource = process.env.KERNIX_MCP_PORT ?? process.env.PORT ?? '8765';
  const port = Number(portSource);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail(`The port must be a valid port number (received "${portSource}").`);
  }

  return {
    baseUrl,
    token,
    tokenSource,
    transport,
    host: process.env.KERNIX_MCP_HOST ?? '127.0.0.1',
    port,
    publicUrl: process.env.KERNIX_MCP_PUBLIC_URL?.replace(/\/+$/, '') ?? null,
    // The API commonly sits on a path under the app's own origin, so that is
    // the assumption when nobody says otherwise — and it is only a default.
    appUrl: (process.env.KERNIX_APP_URL ?? baseUrl.replace(/\/(backend|api)$/, '')).replace(/\/+$/, ''),
    oauthSecret: process.env.KERNIX_MCP_OAUTH_SECRET ?? '',
    allowWrites: envFlag('KERNIX_ALLOW_WRITES', false),
    adminOverride: envFlag('KERNIX_ADMIN_OVERRIDE', false),
    timeoutSeconds: Number(process.env.KERNIX_TIMEOUT_SECONDS ?? 30),
  };
}
