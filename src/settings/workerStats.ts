/**
 * Per-worker request counts and token usage (process + optional disk persist).
 *
 * OpenCode usage shape (observed live):
 * {
 *   prompt_tokens, completion_tokens, total_tokens,
 *   prompt_cache_hit_tokens,   // cache read
 *   prompt_cache_miss_tokens,  // input tokens not served from cache
 *   prompt_tokens_details: { cached_tokens },
 *   completion_tokens_details: { reasoning_tokens }
 * }
 */

import { readFile } from "node:fs/promises";
import type { UpstreamAttemptEvent } from "../proxy/upstream.js";
import type { ModelTokenUsage, TokenUsage } from "./tokenUsage.js";
import { defaultWorkerStatsPath, WorkerStatsPersistence, type WorkerStatsPersistShape, type WorkerStatsWriter } from "./workerStatsPersistence.js";
import { emptyWorkerStat } from "./workerStatsSnapshot.js";

export type { ModelTokenUsage, TokenUsage } from "./tokenUsage.js";
export { parseUsageFromObject, parseUsageFromSseBuffer } from "./tokenUsage.js";

export type WorkerStatSnapshot = {
  accountId: string;
  /** All counted upstream attempts (chat + models). */
  requestCount: number;
  chatCount: number;
  /** Requests made to the /models endpoint (kept for persisted/API compatibility). */
  modelsCount: number;
  /** Logical client generation requests grouped by model (retry chains count once). */
  modelUsage: Record<string, number>;
  /** Actual generation attempts handled by this Worker, grouped by model. */
  modelAttemptUsage: Record<string, number>;
  /** Token and cache totals grouped by requested model. */
  modelTokenUsage: Record<string, ModelTokenUsage>;
  /** Number of distinct models represented in modelUsage. */
  distinctModelCount: number;
  successCount: number;
  errorCount: number;
  generationAttemptCount: number;
  generationSuccessCount: number;
  generationErrorCount: number;
  generationRequestCount: number;
  generationCompletedSuccessCount: number;
  generationCompletedErrorCount: number;
  usageReportedCount: number;
  usageMissingCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheMissTokens: number;
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

const MAX_RECENT_ATTEMPTS = 200;

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
  return Math.min(1, cacheRead / prompt);
}

function parseModelUsage(v: unknown): Record<string, number> {
  const raw = asRecord(v);
  const usage: Record<string, number> = {};
  if (!raw) return usage;
  for (const [model, count] of Object.entries(raw)) {
    const name = model.trim();
    const safeCount = num(count);
    if (name && safeCount) {
      Object.defineProperty(usage, name, {
        value: safeCount,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  return usage;
}

function parseModelTokenUsage(v: unknown): Record<string, ModelTokenUsage> {
  const raw = asRecord(v);
  const usage: Record<string, ModelTokenUsage> = {};
  if (!raw) return usage;
  for (const [model, value] of Object.entries(raw)) {
    const item = asRecord(value);
    if (!item) continue;
    const name = model.trim();
    if (!name) continue;
    usage[name] = {
      requestCount: num(item.requestCount),
      promptTokens: num(item.promptTokens),
      completionTokens: num(item.completionTokens),
      totalTokens: num(item.totalTokens),
      cacheReadTokens: num(item.cacheReadTokens),
      cacheWriteTokens: num(item.cacheWriteTokens),
      cacheMissTokens: num(item.cacheMissTokens),
    };
  }
  return usage;
}

function recordModelUsage(
  usage: Record<string, number>,
  model: string | null | undefined
): void {
  const name = model?.trim();
  if (!name) return;
  const current = Object.hasOwn(usage, name) ? usage[name] : 0;
  Object.defineProperty(usage, name, {
    value: current + 1,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function mergeModelUsage(target: Record<string, number>, source: Record<string, number>): void {
  for (const [model, count] of Object.entries(source)) {
    const current = Object.hasOwn(target, model) ? target[model] : 0;
    Object.defineProperty(target, model, {
      value: current + count, enumerable: true, configurable: true, writable: true,
    });
  }
}

function ensureModelTokenUsage(s: WorkerStatSnapshot, model: string): ModelTokenUsage {
  return s.modelTokenUsage[model] ?? (s.modelTokenUsage[model] = {
    requestCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheMissTokens: 0,
  });
}

function withDerived(s: WorkerStatSnapshot): WorkerStatSnapshot {
  return {
    ...s,
    distinctModelCount: Object.keys(s.modelUsage).length,
    cacheRate: computeCacheRate(s.cacheReadTokens, s.promptTokens),
  };
}

export class WorkerStatsStore {
  readonly path: string;
  private stats = new Map<string, WorkerStatSnapshot>();
  private attempts: WorkerAttemptRecord[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private persistEnabled: boolean;
  private persistence: WorkerStatsPersistence;
  private closed = false;
  private closePromise: Promise<void> | null = null;

  constructor(opts?: {
    path?: string;
    persist?: boolean;
    writeFile?: WorkerStatsWriter;
  }) {
    this.path = opts?.path ?? process.env.OPENCODE_MANAGER_STATS_PATH ?? defaultWorkerStatsPath();
    this.persistEnabled = opts?.persist !== false;
    this.persistence = new WorkerStatsPersistence(
      this.path,
      this.persistEnabled,
      opts?.writeFile
    );
  }

  async load(): Promise<void> {
    if (!this.persistEnabled || this.closed) return;
    try {
      const text = await readFile(this.path, "utf8");
      const parsed = JSON.parse(text) as WorkerStatsPersistShape;
      const workers = parsed?.workers;
      if (workers && typeof workers === "object") {
        for (const [id, raw] of Object.entries(workers)) {
          if (!id || !raw || typeof raw !== "object") continue;
          const r = raw as Record<string, unknown>;
          const legacyChat = num(r.chatCount);
          const legacySuccess = num(r.successCount);
          const hasCacheMiss = r.cacheMissTokens !== undefined;
          this.stats.set(
            id,
            withDerived({
              accountId: id,
              requestCount: num(r.requestCount),
              chatCount: num(r.chatCount),
              modelsCount: num(r.modelsCount),
              modelUsage: parseModelUsage(r.modelUsage),
              modelAttemptUsage: parseModelUsage(r.modelAttemptUsage ?? r.modelUsage),
              modelTokenUsage: parseModelTokenUsage(r.modelTokenUsage),
              distinctModelCount: 0,
              successCount: num(r.successCount),
              errorCount: num(r.errorCount),
              generationAttemptCount: r.generationAttemptCount === undefined ? legacyChat : num(r.generationAttemptCount),
              generationSuccessCount: r.generationSuccessCount === undefined ? legacySuccess : num(r.generationSuccessCount),
              generationErrorCount: r.generationErrorCount === undefined ? Math.max(0, legacyChat - legacySuccess) : num(r.generationErrorCount),
              generationRequestCount: r.generationRequestCount === undefined ? legacyChat : num(r.generationRequestCount),
              generationCompletedSuccessCount: r.generationCompletedSuccessCount === undefined ? legacySuccess : num(r.generationCompletedSuccessCount),
              generationCompletedErrorCount: r.generationCompletedErrorCount === undefined ? Math.max(0, legacyChat - legacySuccess) : num(r.generationCompletedErrorCount),
              usageReportedCount: num(r.usageReportedCount),
              usageMissingCount: num(r.usageMissingCount),
              promptTokens: num(r.promptTokens),
              completionTokens: num(r.completionTokens),
              totalTokens: num(r.totalTokens),
              cacheReadTokens: num(r.cacheReadTokens),
              cacheWriteTokens: hasCacheMiss ? num(r.cacheWriteTokens) : 0,
              cacheMissTokens: hasCacheMiss ? num(r.cacheMissTokens) : num(r.cacheWriteTokens),
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
    if (this.closed) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.persist().catch((error: unknown) => {
        console.warn(`[worker-stats] failed to persist ${this.path}:`, error);
      });
    }, 500);
    this.saveTimer.unref();
  }

  persist(): Promise<void> {
    const workers: WorkerStatsPersistShape["workers"] = {};
    for (const [id, s] of this.stats) {
      const {
        accountId: _a,
        cacheRate: _r,
        distinctModelCount: _d,
        ...rest
      } = s;
      workers[id] = rest;
    }
    return this.persistence.enqueue(
      JSON.stringify({ workers, attempts: this.attempts }, null, 2)
    );
  }

  /** Cancel debounce and wait until the latest snapshot and all older writes finish. */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.persist();
  }

  /** Stop scheduling background saves and durably flush the latest snapshot. */
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.closePromise = this.flush();
    return this.closePromise;
  }

  private ensure(id: string): WorkerStatSnapshot {
    const key = id || "unknown";
    let s = this.stats.get(key);
    if (!s) {
      s = emptyWorkerStat(key);
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
    opts: { kind: "chat" | "models"; status: number; model?: string | null }
  ): void {
    const s = this.ensure(accountId);
    s.requestCount += 1;
    if (opts.kind === "chat") {
      s.chatCount += 1;
      s.generationAttemptCount += 1;
      s.generationRequestCount += 1;
      if (opts.status >= 200 && opts.status < 300) s.generationSuccessCount += 1;
      else s.generationErrorCount += 1;
      if (opts.status >= 200 && opts.status < 300) s.generationCompletedSuccessCount += 1;
      else s.generationCompletedErrorCount += 1;
      recordModelUsage(s.modelUsage, opts.model);
      recordModelUsage(s.modelAttemptUsage, opts.model);
    } else {
      s.modelsCount += 1;
    }
    if (opts.status >= 200 && opts.status < 300) s.successCount += 1;
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
    const isGeneration = event.operation === "chat" || event.operation === "responses";
    const firstGenerationAttempt = isGeneration && !this.attempts.some(
      (attempt) =>
        attempt.requestId === event.requestId &&
        (attempt.operation === "chat" || attempt.operation === "responses")
    );
    const record: WorkerAttemptRecord = structuredClone({
      ...event,
      ...enrichment,
    });
    this.attempts.push(record);
    if (this.attempts.length > MAX_RECENT_ATTEMPTS) {
      this.attempts.splice(0, this.attempts.length - MAX_RECENT_ATTEMPTS);
    }

    if (
      event.operation === "chat" ||
      event.operation === "responses" ||
      event.operation === "models"
    ) {
      const s = this.ensure(event.accountId);
      s.requestCount += 1;
      if (event.operation === "chat" || event.operation === "responses") {
        s.chatCount += 1;
        s.generationAttemptCount += 1;
        recordModelUsage(s.modelAttemptUsage, event.model);
        if (event.status !== null && event.status >= 200 && event.status < 300) {
          s.generationSuccessCount += 1;
        } else {
          s.generationErrorCount += 1;
        }
        if (firstGenerationAttempt) {
          s.generationRequestCount += 1;
          recordModelUsage(s.modelUsage, event.model);
        }
        if (!event.willRetry) {
          if (event.status !== null && event.status >= 200 && event.status < 300) {
            s.generationCompletedSuccessCount += 1;
          } else {
            s.generationCompletedErrorCount += 1;
          }
        }
      } else {
        s.modelsCount += 1;
      }
      if (event.status !== null && event.status >= 200 && event.status < 300) {
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

  addTokens(accountId: string, usage: TokenUsage, model?: string | null): void {
    const s = this.ensure(accountId);
    const promptTokens = num(usage.promptTokens);
    const completionTokens = num(usage.completionTokens);
    const totalTokens = num(usage.totalTokens);
    const cacheReadTokens = num(usage.cacheReadTokens);
    const cacheWriteTokens = num(usage.cacheWriteTokens);
    const cacheMissTokens = num(usage.cacheMissTokens);
    s.promptTokens += promptTokens;
    s.completionTokens += completionTokens;
    s.totalTokens += totalTokens;
    s.cacheReadTokens += cacheReadTokens;
    s.cacheWriteTokens += cacheWriteTokens;
    s.cacheMissTokens += cacheMissTokens;
    s.usageReportedCount += 1;
    const name = model?.trim();
    if (name) {
      const modelUsage = ensureModelTokenUsage(s, name);
      modelUsage.promptTokens += promptTokens;
      modelUsage.completionTokens += completionTokens;
      modelUsage.totalTokens += totalTokens;
      modelUsage.cacheReadTokens += cacheReadTokens;
      modelUsage.cacheWriteTokens += cacheWriteTokens;
      modelUsage.cacheMissTokens += cacheMissTokens;
      modelUsage.requestCount += 1;
    }
    this.stats.set(s.accountId, withDerived(s));
    this.scheduleSave();
  }

  recordMissingUsage(accountId: string): void {
    const s = this.ensure(accountId);
    s.usageMissingCount += 1;
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
    modelUsage: Record<string, number>;
    modelAttemptUsage: Record<string, number>;
    modelTokenUsage: Record<string, ModelTokenUsage>;
    distinctModelCount: number;
    generationAttemptCount: number;
    generationSuccessCount: number;
    generationErrorCount: number;
    generationRequestCount: number;
    generationCompletedSuccessCount: number;
    generationCompletedErrorCount: number;
    usageReportedCount: number;
    usageMissingCount: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    cacheMissTokens: number;
    cacheRate: number | null;
  } {
    const list = accountIds ? this.listForAccounts(accountIds) : this.getAll();
    const acc = list.reduce(
      (a, s) => {
        a.requestCount += s.requestCount;
        a.chatCount += s.chatCount;
        a.modelsCount += s.modelsCount;
        a.generationAttemptCount += s.generationAttemptCount;
        a.generationSuccessCount += s.generationSuccessCount;
        a.generationErrorCount += s.generationErrorCount;
        a.generationRequestCount += s.generationRequestCount;
        a.generationCompletedSuccessCount += s.generationCompletedSuccessCount;
        a.generationCompletedErrorCount += s.generationCompletedErrorCount;
        a.usageReportedCount += s.usageReportedCount;
        a.usageMissingCount += s.usageMissingCount;
        mergeModelUsage(a.modelUsage, s.modelUsage);
        mergeModelUsage(a.modelAttemptUsage, s.modelAttemptUsage);
        for (const [model, modelTokens] of Object.entries(s.modelTokenUsage)) {
          const target = a.modelTokenUsage[model] ?? (a.modelTokenUsage[model] = {
            requestCount: 0,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            cacheMissTokens: 0,
          });
          target.requestCount += modelTokens.requestCount;
          target.promptTokens += modelTokens.promptTokens;
          target.completionTokens += modelTokens.completionTokens;
          target.totalTokens += modelTokens.totalTokens;
          target.cacheReadTokens += modelTokens.cacheReadTokens;
          target.cacheWriteTokens += modelTokens.cacheWriteTokens;
          target.cacheMissTokens += modelTokens.cacheMissTokens;
        }
        a.promptTokens += s.promptTokens;
        a.completionTokens += s.completionTokens;
        a.totalTokens += s.totalTokens;
        a.cacheReadTokens += s.cacheReadTokens;
        a.cacheWriteTokens += s.cacheWriteTokens;
        a.cacheMissTokens += s.cacheMissTokens;
        return a;
      },
      {
        requestCount: 0,
        chatCount: 0,
        modelsCount: 0,
        modelUsage: {} as Record<string, number>,
        modelAttemptUsage: {} as Record<string, number>,
        modelTokenUsage: {} as Record<string, ModelTokenUsage>,
        generationAttemptCount: 0,
        generationSuccessCount: 0,
        generationErrorCount: 0,
        generationRequestCount: 0,
        generationCompletedSuccessCount: 0,
        generationCompletedErrorCount: 0,
        usageReportedCount: 0,
        usageMissingCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cacheMissTokens: 0,
      }
    );
    return {
      ...acc,
      distinctModelCount: Object.keys(acc.modelUsage).length,
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
    await this.flush();
  }
}
