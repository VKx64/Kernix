import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import type { Config } from './config.js';

/**
 * OAuth for clients that will not carry a bearer token.
 *
 * Claude Desktop and Claude Code let a person paste a Kernix token straight
 * into their config, which is the whole of the authentication story there.
 * ChatGPT's custom connectors do not: the form offers OAuth or nothing at all,
 * so a token Kernix already knows how to check has no field to go in. Without
 * this, the answer to "connect ChatGPT" is "you cannot".
 *
 * So this server speaks the MCP authorization flow — discovery, dynamic client
 * registration, an authorization code with PKCE — and ends it by handing back a
 * Kernix personal access token as the access token. Nothing downstream changes:
 * every request still arrives as `Authorization: Bearer <kernix token>`, and
 * Kernix still applies the account's own permissions to it. The flow exists to
 * get the token into the client's hands, not to invent a second idea of who
 * somebody is.
 *
 * Two things are worth knowing about the design:
 *
 * Nothing is stored. There is no database here and shared hosting restarts this
 * process on a whim, so every value that has to survive a round trip — the
 * registered client, the in-flight request, the authorization code — is sealed
 * into the string handed to the other side and opened again when it comes back.
 * Sealed, not signed: an authorization code carries a real Kernix token, and a
 * signed-but-readable blob would put that token in a URL for anyone who sees it.
 *
 * The person is authenticated by Kernix, not here. The authorize endpoint sends
 * the browser to the Kernix app, which already knows who is signed in and can
 * ask them plainly whether to allow this. It comes back with a short-lived
 * handoff that only this server can spend, so the token itself never travels
 * through the browser.
 */

/** How long a person has to finish approving before the request goes stale. */
const REQUEST_TTL_SECONDS = 600;
/** An authorization code is spent immediately; this is slack, not a window. */
const CODE_TTL_SECONDS = 120;

interface ClientRecord {
  redirect_uris: string[];
  name: string;
}

interface PendingRequest {
  redirect_uri: string;
  code_challenge: string;
  state?: string;
  scope?: string;
  name: string;
  exp: number;
}

interface AuthorizationCode {
  token: string;
  redirect_uri: string;
  code_challenge: string;
  jti: string;
  exp: number;
}

/**
 * Codes are single-use. The record of what has been spent is in memory and so
 * does not survive a restart, but neither does anything else here, and a code
 * outlives its issue by two minutes — a replay has to land inside that window
 * and on the same process to be worth anything.
 */
const spent = new Map<string, number>();

function burn(jti: string, exp: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  for (const [seen, expiry] of spent) if (expiry < now) spent.delete(seen);
  if (spent.has(jti)) return false;
  spent.set(jti, exp);
  return true;
}

function keyFrom(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

/**
 * Encrypt-then-authenticate, with the blob's purpose as associated data so a
 * client id can never be opened as an authorization code.
 */
function seal(secret: string, purpose: string, payload: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  cipher.setAAD(Buffer.from(purpose));
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

function open<T>(secret: string, purpose: string, blob: string): T | null {
  try {
    const raw = Buffer.from(blob, 'base64url');
    if (raw.length < 29) return null;
    const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(raw.subarray(12, 28));
    const plain = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
    return JSON.parse(plain.toString('utf8')) as T;
  } catch {
    // A blob that will not open is a forgery, a truncation, or a leftover from
    // before the secret changed. All three mean the same thing to the caller.
    return null;
  }
}

function pkceMatches(verifier: string, challenge: string): boolean {
  return createHash('sha256').update(verifier).digest('base64url') === challenge;
}

function expired(at: number): boolean {
  return at < Math.floor(Date.now() / 1000);
}

/** Where this deployment answers, as the outside world sees it. */
export function originOf(request: Request, config: Config): string {
  if (config.publicUrl) return config.publicUrl.replace(/\/mcp$/, '');
  const proto = (request.get('x-forwarded-proto') ?? request.protocol ?? 'http').split(',')[0]?.trim() || 'http';
  return `${proto}://${request.get('host') ?? `${config.host}:${config.port}`}`;
}

/**
 * A redirect target has to be one the client registered, matched whole. Prefix
 * matching is the classic way this goes wrong: a client that registers
 * `https://example.com/cb` should not thereby accept `https://example.com/cb.evil`.
 */
function registered(client: ClientRecord, redirectUri: string): boolean {
  return client.redirect_uris.includes(redirectUri);
}

function usableRedirect(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return true;
    // Local clients legitimately redirect to a loopback port.
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

/** A plain page for the failures that must not be redirected onward. */
function fail(response: Response, status: number, title: string, detail: string): void {
  response
    .status(status)
    .type('html')
    .send(
      `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
        `<body style="font:16px/1.5 system-ui;margin:4rem auto;max-width:34rem;padding:0 1.5rem">` +
        `<h1 style="font-size:1.25rem">${title}</h1><p>${detail}</p></body>`,
    );
}

function redirectWithError(response: Response, redirectUri: string, state: string | undefined, error: string, description: string): void {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  url.searchParams.set('error_description', description);
  if (state) url.searchParams.set('state', state);
  response.redirect(url.toString());
}

/**
 * Registers the authorization endpoints, and reports whether they are live.
 *
 * They need a secret that outlasts the process: it is what makes a registered
 * client still valid after this server restarts, which on shared hosting it
 * does regularly. Without one the endpoints answer honestly that they are not
 * configured rather than the server refusing to boot — a missing secret should
 * cost you ChatGPT, not the connections that are already working.
 */
export function mountOAuth(app: Express, config: Config): boolean {
  const secret = config.oauthSecret;

  if (!secret) {
    const unconfigured = (_request: Request, response: Response) => {
      response.status(501).json({
        error: 'oauth_not_configured',
        error_description:
          'This deployment has no KERNIX_MCP_OAUTH_SECRET set, so sign-in through a connector is off. ' +
          'Clients that accept a bearer token can still connect with one.',
      });
    };
    for (const path of [
      '/.well-known/oauth-authorization-server',
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/mcp',
      '/oauth/authorize',
      '/oauth/callback',
    ]) {
      app.get(path, unconfigured);
    }
    app.post('/oauth/register', unconfigured);
    app.post('/oauth/token', unconfigured);
    return false;
  }

  // Discovery. Clients look for the resource document under both the bare
  // well-known path and one suffixed with the resource's own path, and for the
  // authorization server document under the bare path; all are served rather
  // than betting on which spelling a given client picked.
  const protectedResource = (request: Request, response: Response) => {
    const origin = originOf(request, config);
    response.json({
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      bearer_methods_supported: ['header'],
      scopes_supported: ['kernix'],
      resource_name: 'Kernix',
      resource_documentation: `${config.appUrl}/settings/workspace`,
    });
  };
  app.get('/.well-known/oauth-protected-resource', protectedResource);
  app.get('/.well-known/oauth-protected-resource/mcp', protectedResource);

  const authorizationServer = (request: Request, response: Response) => {
    const origin = originOf(request, config);
    response.json({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      // Public clients only, and PKCE is the whole of the client's proof. There
      // is no secret to hand out that a browser-side client could keep.
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['kernix'],
      service_documentation: `${config.appUrl}/settings/workspace`,
    });
  };
  app.get('/.well-known/oauth-authorization-server', authorizationServer);
  app.get('/.well-known/oauth-authorization-server/mcp', authorizationServer);

  /**
   * Dynamic client registration. ChatGPT registers itself the moment a
   * connector is added, so this cannot be a form somebody fills in by hand.
   *
   * The client id is the registration, sealed — there is no table of clients,
   * and a client that presents its id is presenting the redirect list it was
   * issued with.
   */
  app.post('/oauth/register', (request, response) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
    const usable = uris.filter(usableRedirect);

    if (usable.length === 0) {
      response.status(400).json({
        error: 'invalid_redirect_uri',
        error_description: 'Give at least one https redirect URI (http is accepted only for localhost).',
      });
      return;
    }

    const name = typeof body.client_name === 'string' && body.client_name.trim()
      ? body.client_name.trim().slice(0, 60)
      : 'AI assistant';
    const record: ClientRecord = { redirect_uris: usable, name };

    response.status(201).json({
      client_id: seal(secret, 'client', record),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: usable,
      client_name: name,
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
  });

  /**
   * The person's half of the flow. Everything here is checked before a browser
   * is sent anywhere, because an unvalidated redirect target is how an
   * authorization endpoint becomes an open redirect.
   */
  app.get('/oauth/authorize', (request, response) => {
    const query = request.query as Record<string, string | undefined>;
    const client = query.client_id ? open<ClientRecord>(secret, 'client', query.client_id) : null;

    if (!client) {
      fail(response, 400, 'Unknown connector', 'This client is not registered with Kernix, or the registration is no longer valid. Remove the connector and add it again.');
      return;
    }
    if (!query.redirect_uri || !registered(client, query.redirect_uri)) {
      fail(response, 400, 'Unexpected redirect', 'This connector asked to be sent somewhere it did not register. Nothing was approved.');
      return;
    }

    const state = query.state;
    if (query.response_type !== 'code') {
      redirectWithError(response, query.redirect_uri, state, 'unsupported_response_type', 'Only the authorization code flow is supported.');
      return;
    }
    if (!query.code_challenge || query.code_challenge_method !== 'S256') {
      redirectWithError(response, query.redirect_uri, state, 'invalid_request', 'PKCE with S256 is required.');
      return;
    }

    const pending: PendingRequest = {
      redirect_uri: query.redirect_uri,
      code_challenge: query.code_challenge,
      state,
      scope: query.scope,
      name: client.name,
      exp: Math.floor(Date.now() / 1000) + REQUEST_TTL_SECONDS,
    };

    // Kernix owns the sign-in and the consent screen. It knows who is signed in,
    // which workspace they are in, and how to ask them; this server knows none
    // of that and should not learn it.
    const consent = new URL('/assistant/authorize', config.appUrl);
    consent.searchParams.set('request', seal(secret, 'request', pending));
    consent.searchParams.set('return', `${originOf(request, config)}/oauth/callback`);
    consent.searchParams.set('client', client.name);
    response.redirect(consent.toString());
  });

  /**
   * Kernix sends the browser back here once the person has said yes. The
   * handoff is spent server to server, so the token it stands for never appears
   * in a URL, a browser history, or a proxy log.
   */
  app.get('/oauth/callback', (request, response) => {
    void (async () => {
      const query = request.query as Record<string, string | undefined>;
      const pending = query.request ? open<PendingRequest>(secret, 'request', query.request) : null;

      if (!pending) {
        fail(response, 400, 'That approval did not match', 'Start again from the connector — this approval could not be read.');
        return;
      }
      if (expired(pending.exp)) {
        fail(response, 400, 'That approval expired', 'It was left too long before being confirmed. Start again from the connector.');
        return;
      }
      if (!query.handoff) {
        redirectWithError(response, pending.redirect_uri, pending.state, 'access_denied', 'The request was not approved.');
        return;
      }

      let token: string;
      try {
        token = await claimToken(config, query.handoff);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Kernix did not complete the approval.';
        fail(response, 502, 'Kernix could not finish the approval', detail);
        return;
      }

      const code: AuthorizationCode = {
        token,
        redirect_uri: pending.redirect_uri,
        code_challenge: pending.code_challenge,
        jti: randomUUID(),
        exp: Math.floor(Date.now() / 1000) + CODE_TTL_SECONDS,
      };

      const back = new URL(pending.redirect_uri);
      back.searchParams.set('code', seal(secret, 'code', code));
      if (pending.state) back.searchParams.set('state', pending.state);
      response.redirect(back.toString());
    })();
  });

  /** Code for token. The access token returned is the Kernix token itself. */
  app.post('/oauth/token', (request, response) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const read = (key: string): string | undefined => (typeof body[key] === 'string' ? (body[key] as string) : undefined);

    if (read('grant_type') !== 'authorization_code') {
      response.status(400).json({
        error: 'unsupported_grant_type',
        error_description: 'Only the authorization_code grant is supported. This server issues no refresh tokens.',
      });
      return;
    }

    const raw = read('code');
    const code = raw ? open<AuthorizationCode>(secret, 'code', raw) : null;
    if (!code || expired(code.exp)) {
      response.status(400).json({ error: 'invalid_grant', error_description: 'That authorization code is not valid any more.' });
      return;
    }

    const redirectUri = read('redirect_uri');
    if (redirectUri && redirectUri !== code.redirect_uri) {
      response.status(400).json({ error: 'invalid_grant', error_description: 'The redirect URI does not match the one the code was issued for.' });
      return;
    }

    const verifier = read('code_verifier');
    if (!verifier || !pkceMatches(verifier, code.code_challenge)) {
      response.status(400).json({ error: 'invalid_grant', error_description: 'The PKCE verifier does not match.' });
      return;
    }
    if (!burn(code.jti, code.exp)) {
      response.status(400).json({ error: 'invalid_grant', error_description: 'That authorization code has already been used.' });
      return;
    }

    response.set('Cache-Control', 'no-store').json({
      access_token: code.token,
      token_type: 'Bearer',
      scope: 'kernix',
    });
  });

  return true;
}

/**
 * Trades the one-time handoff for the Kernix token it stands for.
 *
 * Kernix minted the token when the person approved, and holds it for a couple
 * of minutes against exactly one presentation of this value.
 */
async function claimToken(config: Config, handoff: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutSeconds * 1000);
  try {
    const response = await fetch(`${config.baseUrl}/api/mcp/authorize/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ handoff }),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as
      | { data?: { token?: string }; token?: string; message?: string }
      | null;

    if (!response.ok) {
      throw new Error(payload?.message ?? `Kernix answered ${response.status}.`);
    }
    const token = payload?.data?.token ?? payload?.token;
    if (!token) throw new Error('Kernix returned no token for that approval.');
    return token;
  } finally {
    clearTimeout(timer);
  }
}
