/**
 * Per-worker request counts and token usage (process + optional disk persist).
 *
 * OpenCode usage shape (observed live):
 * {
 *   prompt_tokens, completion_tokens, total_tokens,
 *   prompt_cache_hit_tokens,   // cache read
 *   prompt_cache_miss_tokens,  // not from cache (treated as cache write when no explicit write field)
 *   prompt_tokens_details: { cached_tokens },
 *   completion_tokens_details: { reasoning_tokens }
 * }
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { UpstreamAttemptEvent } from "../proxy/upstream.js";

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Tokens read from prompt cache (hit). */
  cacheReadTokens: number;
  /** Tokens written to / missing from cache. */
  cacheWriteTokens: number;
};

export type WorkerStatSnapshot = {
  accountId: string;
  /** All counted upstream attempts (chat + models). */
  requestCount: number;
  chatCount: number;
  modelsCount: number;
  successCount: number;
  errorCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /**
   * Cache hit rate over accumulated prompt tokens: cacheRead / promptTokens.
   * null when promptTokens is 0.
   */
  cacheRate: number | null;
  lastRequestAt: string | null;
  lastStatus: number | null;
};

export type WorkerAttemptEnrichment = {
  proxyName?: string | null;
  egressIp?: string | null;
  credentialLabel?: string;
};

export type WorkerAttemptRecord = UpstreamAttemptEvent & WorkerAttemptEnrichment;

type PersistShape = {
  workers: Record<string, Omit<WorkerStatSnapshot, "accountId" | "cacheRate">>;
  attempts?: WorkerAttemptRecord[];
};

const MAX_RECENT_ATTEMPTS = 200;

function emptyStat(accountId: string): WorkerStatSnapshot {
  return {
    accountId,
    requestCount: 0,
    chatCount: 0,
    modelsCount: 0,
    successCount: 0,
    errorCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheRate: null,
    lastRequestAt: null,
    lastStatus: null,
  };
}

/** Non-negative integer (0 allowed). */
function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function computeCacheRate(cacheRead: number, prompt: number): number | null {
  if (prompt <= 0) return null;
  return cacheRead / prompt;
}

function withDerived(s: WorkerStatSnapshot): WorkerStatSnapshot {
  return {
    ...s,
    cacheRate: computeCacheRate(s.cacheReadTokens, s.promptTokens),
  };
}

function parseCacheTokens(usage: Record<string, unknown>): {
  cacheReadTokens: number;
  cacheWriteTokens: number;
} {
  const details = asRecord(usage.prompt_tokens_details) ?? {};
  const inputDetails = asRecord(usage.input_tokens_details) ?? {};

  // Cache read / hit
  const cacheReadTokens = num(
    usage.prompt_cache_hit_tokens ??
      usage.cache_read_input_tokens ??
      usage.cache_read_tokens ??
      details.cached_tokens ??
      inputDetails.cached_tokens
  );

  // Explicit write / creation fields (OpenAI GPT-5.6+, Anthropic, …)
  let cacheWriteTokens = num(
    usage.cache_write_tokens ??
      usage.prompt_cache_write_tokens ??
      usage.cache_creation_input_tokens ??
      usage.cache_creation_tokens ??
      details.cache_write_tokens ??
      details.cache_creation_tokens ??
      inputDetails.cache_write_tokens
  );

  // OpenCode / DeepSeek: miss tokens = prompt tokens not served from cache
  // (used as write/uncached when no dedicated write field is present).
  const miss = num(usage.prompt_cache_miss_tokens);
  if (!cacheWriteTokens && miss) {
    cacheWriteTokens = miss;
  }

  return { cacheReadTokens, cacheWriteTokens };
}

/** Extract OpenAI / OpenCode-style usage from a JSON completion object. */
export function parseUsageFromObject(obj: unknown): TokenUsage | null {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const root = obj as Record<string, unknown>;
  const u = root.usage;
  if (!u || typeof u !== "object" || Array.isArray(u)) return null;
  const usage = u as Record<string, unknown>;
  const promptTokens = num(usage.prompt_tokens ?? usage.input_tokens);
  const completionTokens = num(usage.completion_tokens ?? usage.output_tokens);
  let totalTokens = num(usage.total_tokens);
  if (!totalTokens && (promptTokens || completionTokens)) {
    totalTokens = promptTokens + completionTokens;
  }
  const { cacheReadTokens, cacheWriteTokens } = parseCacheTokens(usage);

  if (
    !promptTokens &&
    !completionTokens &&
    !totalTokens &&
    !cacheReadTokens &&
    !cacheWriteTokens
  ) {
    return null;
  }
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cacheReadTokens,
    cacheWriteTokens,
  };
}

/** Scan SSE buffer for the last usage object in `data:` lines. */
export function parseUsageFromSseBuffer(buf: string): TokenUsage | null {
  let found: TokenUsage | null = null;
  const lines = buf.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const obj = JSON.parse(data) as unknown;
      const u = parseUsageFromObject(obj);
      if (u) found = u;
    } catch {
      /* ignore partial SSE frames */
    }
  }
  return found;
}

function defaultStatsPath(): string {
  return resolve(process.cwd(), "data", "worker-stats.json");
}

export class WorkerStatsStore {
  readonly path: string;
  private stats = new Map<string, WorkerStatSnapshot>();
  private attempts: WorkerAttemptRecord[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private persistEnabled: boolean;

  constructor(opts?: { path?: string; persist?: boolean }) {
    this.path = opts?.path ?? process.env.OCFREERELAY_STATS_PATH ?? defaultStatsPath();
    this.persistEnabled = opts?.persist !== false;
  }

  async load(): Promise<void> {
    if (!this.persistEnabled) return;
    try {
      const text = await readFile(this.path, "utf8");
      const parsed = JSON.parse(text) as PersistShape;
      const workers = parsed?.workers;
      if (workers && typeof workers === "object") {
        for (const [id, raw] of Object.entries(workers)) {
          if (!id || !raw || typeof raw !== "object") continue;
          const r = raw as Record<string, unknown>;
          this.stats.set(
            id,
            withDerived({
              accountId: id,
              requestCount: num(r.requestCount),
              chatCount: num(r.chatCount),
              modelsCount: num(r.modelsCount),
              successCount: num(r.successCount),
              errorCount: num(r.errorCount),
              promptTokens: num(r.promptTokens),
              completionTokens: num(r.completionTokens),
              totalTokens: num(r.totalTokens),
              cacheReadTokens: num(r.cacheReadTokens),
              cacheWriteTokens: num(r.cacheWriteTokens),
              cacheRate: null,
              lastRequestAt: typeof r.lastRequestAt === "string" ? r.lastRequestAt : null,
              lastStatus: typeof r.lastStatus === "number" ? r.lastStatus : null,
            })
          );
        }
      }
      if (Array.isArray(parsed?.attempts)) {
        this.attempts = parsed.attempts
          .filter((attempt): attempt is WorkerAttemptRecord => {
            if (!attempt || typeof attempt !== "object") return false;
            return (
              typeof attempt.requestId === "string" &&
              typeof attempt.accountId === "string" &&
              typeof attempt.at === "string"
            );
          })
          .slice(-MAX_RECENT_ATTEMPTS);
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        console.warn(`[worker-stats] failed to load ${this.path}:`, err);
      }
    }
  }

  private scheduleSave(): void {
    if (!this.persistEnabled) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.persist();
    }, 500);
  }

  async persist(): Promise<void> {
    if (!this.persistEnabled) return;
    const workers: PersistShape["workers"] = {};
    for (const [id, s] of this.stats) {
      const { accountId: _a, cacheRate: _r, ...rest } = s;
      workers[id] = rest;
    }
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(
      this.path,
      JSON.stringify({ workers, attempts: this.attempts }, null, 2),
      "utf8"
    );
  }

  private ensure(id: string): WorkerStatSnapshot {
    const key = id || "unknown";
    let s = this.stats.get(key);
    if (!s) {
      s = emptyStat(key);
      this.stats.set(key, s);
    }
    return s;
  }

  /**
   * Record one upstream attempt attributed to a worker.
   * @param kind chat | models
   */
  recordRequest(
    accountId: string,
    opts: { kind: "chat" | "models"; status: number }
  ): void {
    const s = this.ensure(accountId);
    s.requestCount += 1;
    if (opts.kind === "chat") s.chatCount += 1;
    else s.modelsCount += 1;
    if (opts.status >= 200 && opts.status < 400) s.successCount += 1;
    else s.errorCount += 1;
    s.lastStatus = opts.status;
    s.lastRequestAt = new Date().toISOString();
    this.stats.set(s.accountId, withDerived(s));
    this.scheduleSave();
  }

  /** Record an individual upstream route attempt and update request aggregates. */
  recordAttempt(
    event: UpstreamAttemptEvent & WorkerAttemptEnrichment,
    enrichment?: WorkerAttemptEnrichment
  ): void {
    const record: WorkerAttemptRecord = structuredClone({
      ...event,
      ...enrichment,
    });
    this.attempts.push(record);
    if (this.attempts.length > MAX_RECENT_ATTEMPTS) {
      this.attempts.splice(0, this.attempts.length - MAX_RECENT_ATTEMPTS);
    }

    if (event.operation === "chat" || event.operation === "models") {
      const s = this.ensure(event.accountId);
      s.requestCount += 1;
      if (event.operation === "chat") s.chatCount += 1;
      else s.modelsCount += 1;
      if (event.status !== null && event.status >= 200 && event.status < 400) {
        s.successCount += 1;
      } else {
        s.errorCount += 1;
      }
      s.lastStatus = event.status;
      s.lastRequestAt = event.at;
      this.stats.set(s.accountId, withDerived(s));
    }
    this.scheduleSave();
  }

  /** Most recent attempts, newest first. */
  recentAttempts(limit = 100): WorkerAttemptRecord[] {
    const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 100;
    if (safeLimit === 0) return [];
    return this.attempts
      .slice(-Math.min(safeLimit, MAX_RECENT_ATTEMPTS))
      .reverse()
      .map((attempt) => structuredClone(attempt));
  }

  addTokens(accountId: string, usage: TokenUsage): void {
    const s = this.ensure(accountId);
    s.promptTokens += usage.promptTokens;
    s.completionTokens += usage.completionTokens;
    s.totalTokens += usage.totalTokens;
    s.cacheReadTokens += usage.cacheReadTokens;
    s.cacheWriteTokens += usage.cacheWriteTokens;
    this.stats.set(s.accountId, withDerived(s));
    this.scheduleSave();
  }

  get(accountId: string): WorkerStatSnapshot {
    return structuredClone(withDerived(this.ensure(accountId)));
  }

  /** Stats for known account ids (creates zero rows for missing). */
  listForAccounts(accountIds: string[]): WorkerStatSnapshot[] {
    return accountIds.map((id) => structuredClone(withDerived(this.ensure(id))));
  }

  getAll(): WorkerStatSnapshot[] {
    return [...this.stats.values()].map((s) => structuredClone(withDerived(s)));
  }

  totals(accountIds?: string[]): {
    requestCount: number;
    chatCount: number;
    modelsCount: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    cacheRate: number | null;
  } {
    const list = accountIds ? this.listForAccounts(accountIds) : this.getAll();
    const acc = list.reduce(
      (a, s) => {
        a.requestCount += s.requestCount;
        a.chatCount += s.chatCount;
        a.modelsCount += s.modelsCount;
        a.promptTokens += s.promptTokens;
        a.completionTokens += s.completionTokens;
        a.totalTokens += s.totalTokens;
        a.cacheReadTokens += s.cacheReadTokens;
        a.cacheWriteTokens += s.cacheWriteTokens;
        return a;
      },
      {
        requestCount: 0,
        chatCount: 0,
        modelsCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }
    );
    return {
      ...acc,
      cacheRate: computeCacheRate(acc.cacheReadTokens, acc.promptTokens),
    };
  }

  async reset(accountId?: string): Promise<void> {
    if (accountId) {
      this.stats.delete(accountId);
      this.attempts = this.attempts.filter((attempt) => attempt.accountId !== accountId);
    } else {
      this.stats.clear();
      this.attempts = [];
    }
    await this.persist();
  }
}
