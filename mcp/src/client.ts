import type { Config } from './config.js';

/**
 * Errors that carry a message worth showing the assistant verbatim. Kernix
 * answers a refused write with a sentence written for a person ("This estimate
 * request has already been resolved"), and that sentence is far more useful to
 * a model than an HTTP status, so it is preserved all the way to the tool
 * result instead of being flattened into "request failed".
 */
export class KernixError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly validation?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'KernixError';
  }

  /** One block of text an assistant can read and act on. */
  toText(): string {
    const lines = [this.message];
    for (const [field, messages] of Object.entries(this.validation ?? {})) {
      for (const message of messages) lines.push(`  ${field}: ${message}`);
    }
    if (this.status === 401) {
      lines.push('The API token was rejected. It may have expired or been revoked.');
    }
    if (this.status === 403) {
      lines.push('The account behind this token does not hold the permission this action needs.');
    }
    return lines.join('\n');
  }
}

export interface ListQuery {
  [key: string]: string | number | boolean | undefined | null;
}

/**
 * True when the failure is "this account may not see that" rather than
 * "something went wrong".
 *
 * A tool that sweeps many records — every project's intake, every task's
 * approvals — will hit this on some of them whenever the account is not an
 * administrator. Aborting the whole sweep on the first refusal turns a partial
 * answer into no answer, which is how a production manager ends up being told
 * they have no pending approvals when in fact they have two they can act on.
 */
export function isForbidden(error: unknown): boolean {
  return error instanceof KernixError && (error.status === 403 || error.status === 401);
}

export class KernixClient {
  constructor(private readonly config: Config) {}

  async get<T = unknown>(path: string, query: ListQuery = {}): Promise<T> {
    return this.request<T>('GET', path, { query });
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, { body });
  }

  async put<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, { body });
  }

  async patch<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, { body });
  }

  private async request<T>(
    method: string,
    path: string,
    options: { query?: ListQuery; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(this.config.baseUrl + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutSeconds * 1000);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.config.token}`,
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch (error) {
      clearTimeout(timer);
      const reason = error instanceof Error && error.name === 'AbortError'
        ? `no response within ${this.config.timeoutSeconds}s`
        : error instanceof Error ? error.message : String(error);
      throw new KernixError(`Could not reach Kernix at ${this.config.baseUrl}: ${reason}.`, 0);
    }
    clearTimeout(timer);

    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const record = (payload ?? {}) as Record<string, unknown>;
      const message = typeof record.message === 'string' && record.message
        ? record.message
        : `Kernix returned ${response.status} for ${method} ${path}.`;
      throw new KernixError(
        message,
        response.status,
        record.errors as Record<string, string[]> | undefined,
      );
    }

    // Kernix wraps every successful body in `data`; paginated bodies add `meta`.
    // Callers want the payload, not the envelope, but they also need the page
    // counts, so both are handed back and unwrapped at the call site.
    return payload as T;
  }
}

/** The shape every Kernix list endpoint returns. */
export interface Paginated<T> {
  data: T[];
  meta?: { current_page: number; last_page: number; per_page: number; total: number };
}

export interface Wrapped<T> {
  data: T;
}

export function unwrap<T>(payload: Wrapped<T> | T): T {
  if (payload && typeof payload === 'object' && 'data' in (payload as object)) {
    return (payload as Wrapped<T>).data;
  }
  return payload as T;
}
