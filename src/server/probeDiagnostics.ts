import type { ProbeResult } from "../proxy/probe.js";

type ProbeDiagnostic = {
  event: "probe_failure";
  scope: "single" | "batch";
  nodeId: string;
  health: string;
  reason: string;
  latencyMs: number | null;
  anonymousStatus: string | null;
  anonymousHttpStatus: number | null;
  anonymousLatencyMs: number | null;
  anonymousReasonCode: string | null;
  anonymousRetryAfterSeconds: number | null;
  anonymousError: string | null;
  anonymousModel: string | null;
  anonymousDiagnosis: string | null;
  crossCheckModel: string | null;
  crossCheckStatus: string | null;
  crossCheckHttpStatus: number | null;
};

function bounded(value: string | null | undefined, max: number): string {
  return (value || "").replace(/[\r\n\t]/g, " ").trim().slice(0, max);
}

function sanitizedAnonymousError(value: string | null | undefined): string | null {
  const clean = bounded(value, 160);
  if (!clean) return null;
  return clean
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|key|token)[-_][A-Za-z0-9._-]{6,}\b/gi, "[redacted]")
    .replace(/\/\/[^/@\s]+:[^/@\s]+@/g, "//[redacted]@");
}

function failureReason(result: ProbeResult): string {
  const reason = bounded(result.reason, 80);
  if (reason) return reason;
  const error = bounded(result.error, 120);
  if (/timeout/i.test(error)) return "timeout";
  if (/auth|407/i.test(error)) return "proxy_auth_required";
  if (/abort|cancel/i.test(error)) return "cancelled";
  if (result.anonymousZen && !result.anonymousZen.ok) {
    return `anonymous_${result.anonymousZen.status}`;
  }
  return "probe_failed";
}

export function probeFailureDiagnostic(
  scope: "single" | "batch",
  result: ProbeResult
): ProbeDiagnostic | null {
  if (result.ok && (result.anonymousZen == null || result.anonymousZen.ok)) return null;
  return {
    event: "probe_failure",
    scope,
    nodeId: bounded(result.id, 200),
    health: result.health,
    reason: failureReason(result),
    latencyMs: result.latencyMs,
    anonymousStatus: result.anonymousZen?.status ?? null,
    anonymousHttpStatus: result.anonymousZen?.httpStatus ?? null,
    anonymousLatencyMs: result.anonymousZen?.latencyMs ?? null,
    anonymousReasonCode: result.anonymousZen?.reasonCode ?? null,
    anonymousRetryAfterSeconds: result.anonymousZen?.retryAfterSeconds ?? null,
    anonymousError: sanitizedAnonymousError(result.anonymousZen?.error),
    anonymousModel: result.anonymousZen?.model ?? null,
    anonymousDiagnosis: result.anonymousZen?.diagnosis ?? null,
    crossCheckModel: result.anonymousZen?.crossCheck?.model ?? null,
    crossCheckStatus: result.anonymousZen?.crossCheck?.status ?? null,
    crossCheckHttpStatus: result.anonymousZen?.crossCheck?.httpStatus ?? null,
  };
}

export function logProbeFailure(scope: "single" | "batch", result: ProbeResult): void {
  const diagnostic = probeFailureDiagnostic(scope, result);
  if (diagnostic) console.warn(`[probe] ${JSON.stringify(diagnostic)}`);
}

export function logBatchSummary(results: ProbeResult[], cancelled: boolean): void {
  const usable = results.filter((result) => result.ok && result.anonymousZen?.ok).length;
  const networkFailed = results.filter((result) => !result.ok).length;
  const anonymousFailed = results.filter(
    (result) => result.ok && result.anonymousZen !== undefined && !result.anonymousZen?.ok
  ).length;
  const anonymousStatuses: Record<string, number> = {};
  const anonymousReasons: Record<string, number> = {};
  for (const result of results) {
    const status = result.anonymousZen?.status;
    const reason = result.anonymousZen?.reasonCode;
    if (status) anonymousStatuses[status] = (anonymousStatuses[status] ?? 0) + 1;
    if (reason) anonymousReasons[reason] = (anonymousReasons[reason] ?? 0) + 1;
  }
  console.info(`[probe] ${JSON.stringify({
    event: "batch_summary",
    total: results.length,
    usable,
    networkFailed,
    anonymousFailed,
    anonymousStatuses,
    anonymousReasons,
    cancelled,
  })}`);
}
