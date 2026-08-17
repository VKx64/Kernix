import { KernixClient, KernixError, unwrap } from './client.js';
import { setDisplayZone } from './format.js';

/**
 * Kernix stores status, urgency and type as rows in a per-workspace field
 * catalogue, so its API speaks in integer ids: `status_value_id: 27`. An
 * assistant reasons in words — "move it to quality check" — and cannot be
 * expected to memorise ids that differ per workspace.
 *
 * This resolves between the two in both directions, from one `/api/bootstrap`
 * call that also carries the permission set and the people list. It refreshes
 * lazily: an unknown name is worth one re-fetch before it is reported as
 * invalid, because an admin may have added a status since the process started.
 */

export interface FieldValue {
  id: number;
  key_name: string;
  label: string;
  sort_order: number;
}

export interface Person {
  id: number;
  username: string;
  first_name: string | null;
  last_name: string | null;
  role?: { name?: string } | null;
}

export interface Bootstrap {
  user: { id: number; username: string; first_name?: string; last_name?: string; timezone?: string; role?: { name?: string } };
  permissions: string[];
  fields: Array<{ key_name: string; name: string; values: FieldValue[] }>;
  assignees?: Person[];
  coworkers?: Person[];
  clients?: Array<{ id: number; name: string }>;
  projects?: Array<{ id: number; name: string; client_id?: number }>;
  settings?: Record<string, unknown>;
}

const STALE_AFTER_MS = 5 * 60 * 1000;

export class Vocabulary {
  private snapshot: Bootstrap | null = null;
  private fetchedAt = 0;
  private inflight: Promise<Bootstrap> | null = null;

  constructor(private readonly client: KernixClient) {}

  async load(force = false): Promise<Bootstrap> {
    const fresh = this.snapshot && Date.now() - this.fetchedAt < STALE_AFTER_MS;
    if (fresh && !force) return this.snapshot!;
    // Concurrent tool calls on a cold cache should share one HTTP request
    // rather than each firing their own.
    this.inflight ??= this.client
      .get<{ data: Bootstrap }>('/api/bootstrap')
      .then((payload) => {
        this.snapshot = unwrap(payload);
        this.fetchedAt = Date.now();
        // Dates are rendered in the workspace's timezone, not the host's.
        const settings = this.snapshot.settings as { default_timezone?: string } | undefined;
        setDisplayZone(settings?.default_timezone ?? this.snapshot.user?.timezone);
        return this.snapshot;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  async values(fieldKey: string): Promise<FieldValue[]> {
    const boot = await this.load();
    return boot.fields.find((field) => field.key_name === fieldKey)?.values ?? [];
  }

  /**
   * Accepts a key (`in_progress`), a label (`In Progress`), or anything that
   * matches once punctuation and case are set aside, so an assistant writing
   * "quality-check" or "Quality Check" both land on the same row.
   */
  async idFor(fieldKey: string, name: string): Promise<number> {
    const found = await this.find(fieldKey, name);
    if (found) return found.id;

    // A name that is not in the cache may simply be newer than the cache.
    await this.load(true);
    const retried = await this.find(fieldKey, name);
    if (retried) return retried.id;

    const options = (await this.values(fieldKey)).map((value) => value.key_name).join(', ');
    throw new KernixError(
      `"${name}" is not a valid ${fieldKey.replace('task_', '')} in this workspace. Valid options: ${options}.`,
      422,
    );
  }

  async nameFor(fieldKey: string, id: number | null | undefined): Promise<string | null> {
    if (id === null || id === undefined) return null;
    const values = await this.values(fieldKey);
    return values.find((value) => value.id === id)?.label ?? null;
  }

  private async find(fieldKey: string, name: string): Promise<FieldValue | undefined> {
    const wanted = normalise(name);
    const values = await this.values(fieldKey);
    return values.find(
      (value) => normalise(value.key_name) === wanted || normalise(value.label) === wanted,
    );
  }

  /** Everyone the signed-in account may assign work to. */
  async people(): Promise<Person[]> {
    const boot = await this.load();
    const seen = new Map<number, Person>();
    for (const person of [...(boot.assignees ?? []), ...(boot.coworkers ?? [])]) {
      seen.set(person.id, person);
    }
    return [...seen.values()];
  }

  /** Resolves a username, a full name, or a bare id to a user id. */
  async personId(who: string | number): Promise<number> {
    if (typeof who === 'number') return who;
    if (/^\d+$/.test(who)) return Number(who);

    const wanted = normalise(who);
    const people = await this.people();
    const match = people.find((person) => {
      const full = normalise(`${person.first_name ?? ''} ${person.last_name ?? ''}`);
      return normalise(person.username) === wanted || full === wanted;
    });
    if (match) return match.id;

    const known = people.map((person) => person.username).join(', ');
    throw new KernixError(`No person matches "${who}". Known usernames: ${known}.`, 422);
  }

  async personName(id: number | null | undefined): Promise<string | null> {
    if (id === null || id === undefined) return null;
    const person = (await this.people()).find((candidate) => candidate.id === id);
    if (!person) return null;
    return displayName(person);
  }

  async can(permission: string): Promise<boolean> {
    const boot = await this.load();
    return boot.permissions.includes(permission);
  }
}

export function displayName(person: Person | Bootstrap['user']): string {
  const full = `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim();
  return full || person.username;
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
