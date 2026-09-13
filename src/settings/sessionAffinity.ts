/**
 * Disk persistence for session affinity routing maps.
 *
 * Stores only routing keys (session ids, encrypted-reasoning sha256 digests)
 * mapped to worker ids — never message content, API keys, or credentials.
 * Bindings expire by TTL so a worker removed or re-provisioned months ago
 * cannot pin future sessions.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import {
  DEFAULT_SESSION_AFFINITY_TTL_MS,
  type PersistedAffinityEntry,
  type SessionAffinitySnapshot,
} from "../relay/index.js";

const MAX_SESSION_ENTRIES = 10_000;
const MAX_BLOB_ENTRIES = 5_000;
const MAX_KEY_LENGTH = 256;
const MAX_ID_LENGTH = 256;

export type LoadedSessionAffinity = {
  sessions: PersistedAffinityEntry[];
  blobs: PersistedAffinityEntry[];
};

function cleanKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\r\n\t]/g, " ").trim();
  return clean ? clean.slice(0, MAX_KEY_LENGTH) : null;
}

function cleanId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean ? clean.slice(0, MAX_ID_LENGTH) : null;
}

function cleanAt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function sanitizeEntries(value: unknown): PersistedAffinityEntry[] {
  if (!value || typeof value !== "object") return [];
  const out: PersistedAffinityEntry[] = [];
  const seen = new Set<string>();
  const source = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  for (const raw of source as unknown[]) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const key = cleanKey(item.key);
    const accountId = cleanId(item.accountId);
    const at = cleanAt(item.at);
    if (!key || !accountId || at === null || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, accountId, at });
  }
  return out;
}

export class SessionAffinityStore {
  readonly path: string;
  private pendingState: SessionAffinitySnapshot | null = null;
  private drainPromise: Promise<void> | null = null;

  constructor(
    settingsPath: string,
    path = join(dirname(settingsPath), "session-affinity.json")
  ) {
    this.path = path;
  }

  /**
   * Load persisted bindings, keeping only entries that name a live worker
   * and fall inside the TTL window. Corrupt or missing files yield empty maps.
   */
  async load(
    validAccountIds: Set<string>,
    now = Date.now(),
    ttlMs = DEFAULT_SESSION_AFFINITY_TTL_MS
  ): Promise<LoadedSessionAffinity> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as Record<string, unknown>;
      const keep = (entry: PersistedAffinityEntry): boolean =>
        validAccountIds.has(entry.accountId) && entry.at <= now && now - entry.at <= ttlMs;
      return {
        sessions: sanitizeEntries(parsed.sessions)
          .filter(keep)
          .slice(0, MAX_SESSION_ENTRIES),
        blobs: sanitizeEntries(parsed.blobs)
          .filter(keep)
          .slice(0, MAX_BLOB_ENTRIES),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(
          `[session-affinity] load failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      return { sessions: [], blobs: [] };
    }
  }

  /** Coalesced save: concurrent callers persist the latest snapshot once. */
  save(snapshot: SessionAffinitySnapshot): Promise<void> {
    this.pendingState = {
      sessions: sanitizeEntries(snapshot.sessions).slice(0, MAX_SESSION_ENTRIES),
      blobs: sanitizeEntries(snapshot.blobs).slice(0, MAX_BLOB_ENTRIES),
    };
    const previous = this.drainPromise ?? Promise.resolve();
    const next = previous.then(() => this.drain());
    this.drainPromise = next.catch(() => undefined).then(() => {
      if (!this.pendingState) this.drainPromise = null;
    });
    return next;
  }

  private async drain(): Promise<void> {
    while (this.pendingState) {
      const state = this.pendingState;
      this.pendingState = null;
      await this.persist({ version: 1, ...state });
    }
  }

  private async persist(state: SessionAffinitySnapshot & { version: 1 }): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(temp, this.path);
  }
}
