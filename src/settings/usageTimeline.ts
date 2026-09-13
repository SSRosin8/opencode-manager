const HOUR_MS = 60 * 60 * 1000;
const MAX_HOURS = 168;
const MAX_COUNTER = 1_000_000_000_000;
const MAX_TIMESTAMP = 8_640_000_000_000_000;

export type UsageTimelineBucket = {
  startAt: string;
  requestCount: number;
  successCount: number;
  failureCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheMissTokens: number;
  usageReportedCount: number;
  usageMissingCount: number;
};

export type UsageTimelinePersisted = Record<string, UsageTimelineBucket[]>;

type BucketMap = Map<number, UsageTimelineBucket>;

function count(value: unknown): number {
  let parsed: number;
  try {
    parsed = typeof value === "number" ? value : Number(value);
  } catch {
    return 0;
  }
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(MAX_COUNTER, Math.floor(parsed));
}

function add(current: number, value: number): number {
  return Math.min(MAX_COUNTER, current + value);
}

function bucketStart(timestamp: number): number {
  return Math.floor(timestamp / HOUR_MS) * HOUR_MS;
}

function timestamp(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  let parsed: number;
  try {
    parsed = typeof value === "number" ? value : Date.parse(value);
  } catch {
    return null;
  }
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_TIMESTAMP) return null;
  return parsed;
}

function emptyBucket(start: number): UsageTimelineBucket {
  return {
    startAt: new Date(start).toISOString(),
    requestCount: 0,
    successCount: 0,
    failureCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheMissTokens: 0,
    usageReportedCount: 0,
    usageMissingCount: 0,
  };
}

function parseBucket(raw: unknown): { start: number; bucket: UsageTimelineBucket } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const parsedStart = timestamp(value.startAt);
  if (parsedStart === null) return null;
  const start = bucketStart(parsedStart);
  const bucket = emptyBucket(start);
  bucket.requestCount = count(value.requestCount);
  bucket.successCount = count(value.successCount);
  bucket.failureCount = count(value.failureCount);
  bucket.promptTokens = count(value.promptTokens);
  bucket.completionTokens = count(value.completionTokens);
  bucket.totalTokens = count(value.totalTokens);
  bucket.cacheReadTokens = count(value.cacheReadTokens);
  bucket.cacheWriteTokens = count(value.cacheWriteTokens);
  bucket.cacheMissTokens = count(value.cacheMissTokens);
  bucket.usageReportedCount = count(value.usageReportedCount);
  bucket.usageMissingCount = count(value.usageMissingCount);
  return { start, bucket };
}

function cloneBucket(bucket: UsageTimelineBucket): UsageTimelineBucket {
  return { ...bucket };
}

export class UsageTimeline {
  private readonly workers = new Map<string, BucketMap>();
  private readonly now: () => number;

  constructor(options?: { now?: () => number }) {
    this.now = options?.now ?? Date.now;
  }

  private mapFor(accountId: string): BucketMap {
    const key = accountId || "unknown";
    let buckets = this.workers.get(key);
    if (!buckets) {
      buckets = new Map();
      this.workers.set(key, buckets);
    }
    return buckets;
  }

  private trim(buckets: BucketMap, currentStart = bucketStart(this.now())): void {
    const oldest = currentStart - (MAX_HOURS - 1) * HOUR_MS;
    for (const start of buckets.keys()) {
      if (start < oldest || start > currentStart) buckets.delete(start);
    }
    while (buckets.size > MAX_HOURS) {
      const oldestStart = Math.min(...buckets.keys());
      buckets.delete(oldestStart);
    }
  }

  private ensure(accountId: string, at: number): UsageTimelineBucket {
    const start = bucketStart(at);
    const buckets = this.mapFor(accountId);
    let bucket = buckets.get(start);
    if (!bucket) {
      bucket = emptyBucket(start);
      buckets.set(start, bucket);
    }
    this.trim(buckets, bucketStart(this.now()));
    return bucket;
  }

  recordRequest(accountId: string, status: number, at = this.now()): void {
    const bucket = this.ensure(accountId, at);
    bucket.requestCount = add(bucket.requestCount, 1);
    if (status >= 200 && status < 300) bucket.successCount = add(bucket.successCount, 1);
    else bucket.failureCount = add(bucket.failureCount, 1);
  }

  recordAttempt(accountId: string, operation: string, status: number | null, at: string): void {
    if (operation !== "chat" && operation !== "responses" && operation !== "models") return;
    const parsedAt = timestamp(at);
    if (parsedAt === null) return;
    const bucket = this.ensure(accountId, parsedAt);
    bucket.requestCount = add(bucket.requestCount, 1);
    if (status !== null && status >= 200 && status < 300) bucket.successCount = add(bucket.successCount, 1);
    else bucket.failureCount = add(bucket.failureCount, 1);
  }

  addTokens(accountId: string, usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    cacheMissTokens: number;
  }, at = this.now()): void {
    const bucket = this.ensure(accountId, at);
    bucket.promptTokens = add(bucket.promptTokens, count(usage.promptTokens));
    bucket.completionTokens = add(bucket.completionTokens, count(usage.completionTokens));
    bucket.totalTokens = add(bucket.totalTokens, count(usage.totalTokens));
    bucket.cacheReadTokens = add(bucket.cacheReadTokens, count(usage.cacheReadTokens));
    bucket.cacheWriteTokens = add(bucket.cacheWriteTokens, count(usage.cacheWriteTokens));
    bucket.cacheMissTokens = add(bucket.cacheMissTokens, count(usage.cacheMissTokens));
    bucket.usageReportedCount = add(bucket.usageReportedCount, 1);
  }

  recordMissingUsage(accountId: string, at = this.now()): void {
    const bucket = this.ensure(accountId, at);
    bucket.usageMissingCount = add(bucket.usageMissingCount, 1);
  }

  get(accountIds?: string[], hours = MAX_HOURS): UsageTimelineBucket[] {
    const safeHours = Math.min(MAX_HOURS, Math.max(1, Math.floor(Number(hours) || MAX_HOURS)));
    const current = bucketStart(this.now());
    const starts = Array.from({ length: safeHours }, (_, index) => current - (safeHours - index - 1) * HOUR_MS);
    const selected = accountIds ? new Set(accountIds) : null;
    return starts.map((start) => {
      const result = emptyBucket(start);
      for (const [accountId, buckets] of this.workers) {
        if (selected && !selected.has(accountId)) continue;
        const bucket = buckets.get(start);
        if (!bucket) continue;
        result.requestCount = add(result.requestCount, bucket.requestCount);
        result.successCount = add(result.successCount, bucket.successCount);
        result.failureCount = add(result.failureCount, bucket.failureCount);
        result.promptTokens = add(result.promptTokens, bucket.promptTokens);
        result.completionTokens = add(result.completionTokens, bucket.completionTokens);
        result.totalTokens = add(result.totalTokens, bucket.totalTokens);
        result.cacheReadTokens = add(result.cacheReadTokens, bucket.cacheReadTokens);
        result.cacheWriteTokens = add(result.cacheWriteTokens, bucket.cacheWriteTokens);
        result.cacheMissTokens = add(result.cacheMissTokens, bucket.cacheMissTokens);
        result.usageReportedCount = add(result.usageReportedCount, bucket.usageReportedCount);
        result.usageMissingCount = add(result.usageMissingCount, bucket.usageMissingCount);
      }
      return result;
    });
  }

  load(raw: unknown): void {
    this.workers.clear();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    for (const [accountId, entries] of Object.entries(raw as Record<string, unknown>)) {
      if (!accountId || ["__proto__", "constructor", "prototype"].includes(accountId) || !Array.isArray(entries)) continue;
      const buckets: BucketMap = new Map();
      for (const entry of entries.slice(-MAX_HOURS)) {
        const parsed = parseBucket(entry);
        if (parsed) buckets.set(parsed.start, parsed.bucket);
      }
      this.trim(buckets);
      if (buckets.size) this.workers.set(accountId, buckets);
    }
  }

  serialize(): UsageTimelinePersisted {
    const result: UsageTimelinePersisted = {};
    for (const [accountId, buckets] of this.workers) {
      const entries = [...buckets.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, bucket]) => cloneBucket(bucket));
      if (entries.length) {
        Object.defineProperty(result, accountId, {
          value: entries,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
    }
    return result;
  }

  reset(accountId?: string): void {
    if (accountId) this.workers.delete(accountId);
    else this.workers.clear();
  }
}

export const USAGE_TIMELINE_MAX_HOURS = MAX_HOURS;
