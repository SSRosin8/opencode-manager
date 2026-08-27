import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AnonymousZenProbeReasonCode, AnonymousZenProbeStatus, ProbeHealth, ProbeResult } from "../proxy/probe.js";
import type { BatchProbeProgress } from "../server/context.js";

const MAX_RESULTS = 10_000;
const MAX_TEXT = 240;
const INTERRUPTED_ERROR = "Interrupted by service restart";

type ProbeStateFile = {
  version: 1;
  probeResults: ProbeResult[];
  batchProbe: BatchProbeProgress;
};

export type LoadedProbeState = {
  probeResults: ProbeResult[];
  batchProbe: BatchProbeProgress;
  interrupted: boolean;
};

function text(value: unknown, max = MAX_TEXT): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\r\n\t]/g, " ").trim();
  return clean ? clean.slice(0, max) : null;
}

function timestamp(value: unknown): string | null {
  const clean = text(value, 40);
  return clean && Number.isFinite(Date.parse(clean)) ? clean : null;
}

function number(value: unknown, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(value, max)
    : null;
}

function health(value: unknown): ProbeHealth | null {
  return value === "healthy" || value === "warn" || value === "bad" ||
    value === "testing" || value === "skip" ? value : null;
}

const ANONYMOUS_REASON_CODES = new Set<AnonymousZenProbeReasonCode>([
  "rate_limited", "unauthorized", "forbidden", "proxy_auth_required",
  "payment_required", "invalid_request", "not_found", "request_timeout",
  "request_conflict", "request_rejected", "upstream_failure",
  "unexpected_redirect", "unexpected_http_status", "transport_timeout",
  "transport_dns", "transport_tls", "transport_connection", "transport_failure",
  "primary_model_failure", "provider_failure",
]);

function anonymousReasonCode(value: unknown): AnonymousZenProbeReasonCode | null {
  return typeof value === "string" && ANONYMOUS_REASON_CODES.has(value as AnonymousZenProbeReasonCode)
    ? value as AnonymousZenProbeReasonCode
    : null;
}

function restoredReasonCode(anonymous: Record<string, unknown>): AnonymousZenProbeReasonCode | null {
  const stored = anonymousReasonCode(anonymous.reasonCode);
  if (stored) return stored;
  const status = anonymous.status;
  const httpStatus = number(anonymous.httpStatus, 599);
  if (status === "temporary_failure" && httpStatus != null && httpStatus >= 500) {
    return "upstream_failure";
  }
  return null;
}

function sanitizeError(value: unknown): string | null {
  const clean = text(value);
  if (!clean) return null;
  if (clean === INTERRUPTED_ERROR) return clean;
  if (/timeout/i.test(clean)) return "Timeout";
  if (/auth|407/i.test(clean)) return "proxy auth required (407)";
  if (/abort|cancel/i.test(clean)) return "Cancelled";
  return "Probe failed";
}

function sanitizeCrossCheck(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const model = text(value.model, 200);
  const status = value.status;
  if (!model || (status !== "usable" && status !== "rate_limited" && status !== "blocked" &&
    status !== "temporary_failure" && status !== "unreachable")) return null;
  return {
    model,
    status: status as AnonymousZenProbeStatus,
    ok: value.ok === true,
    httpStatus: number(value.httpStatus, 599),
    latencyMs: number(value.latencyMs, 3_600_000),
    error: sanitizeError(value.error),
    ...(anonymousReasonCode(value.reasonCode) ? { reasonCode: anonymousReasonCode(value.reasonCode)! } : {}),
  };
}

function sanitizeResult(raw: unknown): ProbeResult | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const id = text(value.id, 200);
  const testedAt = timestamp(value.testedAt);
  const probeHealth = health(value.health);
  if (!id || !testedAt || !probeHealth) return null;
  const status = value.anonymousZen && typeof value.anonymousZen === "object"
    ? (value.anonymousZen as Record<string, unknown>).status
    : null;
  const anonymousStatus = status === "usable" || status === "rate_limited" ||
    status === "blocked" || status === "temporary_failure" || status === "unreachable"
    ? status : null;
  const anonymous = anonymousStatus ? value.anonymousZen as Record<string, unknown> : null;
  return {
    id,
    ok: value.ok === true,
    latencyMs: number(value.latencyMs, 3_600_000),
    error: sanitizeError(value.error),
    testedAt,
    health: probeHealth,
    ...(typeof value.egressIp === "string" ? { egressIp: text(value.egressIp, 64) } : {}),
    ...(value.skipped === true ? { skipped: true } : {}),
    ...(text(value.reason, 80) ? { reason: text(value.reason, 80)! } : {}),
    ...(anonymous ? {
      anonymousZen: {
        id,
        status: anonymousStatus!,
        ok: anonymous.ok === true,
        httpStatus: number(anonymous.httpStatus, 599),
        latencyMs: number(anonymous.latencyMs, 3_600_000),
        error: sanitizeError(anonymous.error),
        testedAt: timestamp(anonymous.testedAt) ?? testedAt,
        ...(number(anonymous.retryAfterSeconds, 86_400) != null
          ? { retryAfterSeconds: number(anonymous.retryAfterSeconds, 86_400)! }
          : {}),
        ...(restoredReasonCode(anonymous)
          ? { reasonCode: restoredReasonCode(anonymous)! }
          : {}),
        ...(text(anonymous.model, 200) ? { model: text(anonymous.model, 200)! } : {}),
        ...(anonymous.diagnosis === "primary_model_failure" ||
          anonymous.diagnosis === "provider_failure" || anonymous.diagnosis === "inconclusive"
          ? { diagnosis: anonymous.diagnosis }
          : {}),
        ...(sanitizeCrossCheck(anonymous.crossCheck)
          ? { crossCheck: sanitizeCrossCheck(anonymous.crossCheck)! }
          : {}),
      },
    } : value.anonymousZen === null ? { anonymousZen: null } : {}),
  };
}

function sanitizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item, 200)).filter((item): item is string => !!item))]
    .slice(0, MAX_RESULTS);
}

function sanitizeBatch(raw: unknown, fallback: BatchProbeProgress): BatchProbeProgress {
  if (!raw || typeof raw !== "object") return structuredClone(fallback);
  const value = raw as Record<string, unknown>;
  const stage = value.stage === "screening" || value.stage === "verifying" ? value.stage : null;
  return {
    running: value.running === true,
    paused: value.paused === true,
    cancelRequested: value.cancelRequested === true,
    cancelled: value.cancelled === true,
    total: number(value.total, MAX_RESULTS) ?? 0,
    completed: number(value.completed, MAX_RESULTS) ?? 0,
    completedIds: sanitizeIds(value.completedIds),
    stage,
    stageCompleted: number(value.stageCompleted, MAX_RESULTS) ?? 0,
    stageTotal: number(value.stageTotal, MAX_RESULTS) ?? 0,
    addedWorkerIds: sanitizeIds(value.addedWorkerIds),
    startedAt: timestamp(value.startedAt),
    updatedAt: timestamp(value.updatedAt),
    finishedAt: timestamp(value.finishedAt),
    error: sanitizeError(value.error),
  };
}

export class ProbeStateStore {
  readonly path: string;
  private pendingState: ProbeStateFile | null = null;
  private drainPromise: Promise<void> | null = null;

  constructor(settingsPath: string, path = join(dirname(settingsPath), "probe-state.json")) {
    this.path = path;
  }

  async load(validProxyIds: Set<string>, fallback: BatchProbeProgress): Promise<LoadedProbeState> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as Record<string, unknown>;
      const results = Array.isArray(parsed.probeResults)
        ? parsed.probeResults.map(sanitizeResult).filter((item): item is ProbeResult =>
            Boolean(item && validProxyIds.has(item.id))).slice(0, MAX_RESULTS)
        : [];
      const batchProbe = sanitizeBatch(parsed.batchProbe, fallback);
      batchProbe.completedIds = batchProbe.completedIds.filter((id) => validProxyIds.has(id));
      const interrupted = batchProbe.running;
      if (interrupted) {
        const now = new Date().toISOString();
        Object.assign(batchProbe, {
          running: false, paused: false, cancelRequested: false,
          updatedAt: now, finishedAt: now, error: INTERRUPTED_ERROR,
        });
        await this.save(results, batchProbe).catch((error) => {
          console.warn(`[probe-state] interrupted snapshot save failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
      return { probeResults: results, batchProbe, interrupted };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`[probe-state] load failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      return { probeResults: [], batchProbe: structuredClone(fallback), interrupted: false };
    }
  }

  save(results: ProbeResult[] | Record<string, ProbeResult>, batchProbe: BatchProbeProgress): Promise<void> {
    const list = (Array.isArray(results) ? results : Object.values(results))
      .map(sanitizeResult).filter((item): item is ProbeResult => Boolean(item)).slice(0, MAX_RESULTS);
    const state: ProbeStateFile = {
      version: 1,
      probeResults: list,
      batchProbe: sanitizeBatch(batchProbe, batchProbe),
    };
    this.pendingState = state;
    if (!this.drainPromise) {
      this.drainPromise = this.drain().finally(() => {
        this.drainPromise = null;
      });
    }
    return this.drainPromise;
  }

  private async drain(): Promise<void> {
    while (this.pendingState) {
      const state = this.pendingState;
      this.pendingState = null;
      await this.persist(state);
    }
  }

  private async persist(state: ProbeStateFile): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(temp, this.path);
  }
}
