import { describe, expect, it, vi } from "vitest";
import { logBatchSummary, logProbeFailure, probeFailureDiagnostic } from "../src/server/probeDiagnostics.js";
import type { ProbeResult } from "../src/proxy/probe.js";

function failure(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    id: "node-a",
    ok: false,
    latencyMs: null,
    error: "connect https://user:secret@example.invalid/private failed",
    testedAt: "2026-08-27T01:00:00.000Z",
    health: "bad",
    ...overrides,
  };
}

describe("probe diagnostics", () => {
  it("does not expose raw probe errors", () => {
    expect(probeFailureDiagnostic("single", failure())).toEqual({
      event: "probe_failure",
      scope: "single",
      nodeId: "node-a",
      health: "bad",
      reason: "probe_failed",
      latencyMs: null,
      anonymousStatus: null,
      anonymousHttpStatus: null,
      anonymousLatencyMs: null,
      anonymousReasonCode: null,
      anonymousRetryAfterSeconds: null,
      anonymousError: null,
      anonymousModel: null,
      anonymousDiagnosis: null,
      crossCheckModel: null,
      crossCheckStatus: null,
      crossCheckHttpStatus: null,
    });
  });

  it("does not report a successful signed-in check as an anonymous failure", () => {
    expect(probeFailureDiagnostic("single", failure({
      ok: true, health: "healthy", latencyMs: 12, error: null, anonymousZen: null,
    }))).toBeNull();
  });

  it("writes structured failure and aggregate logs without secrets", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = failure();
    logProbeFailure("batch", result);
    logBatchSummary([result], false);
    const output = [...warn.mock.calls, ...info.mock.calls].flat().join(" ");
    expect(output).toContain('"event":"probe_failure"');
    expect(output).toContain('"event":"batch_summary"');
    expect(output).not.toContain("secret");
    expect(output).not.toContain("example.invalid");
    warn.mockRestore();
    info.mockRestore();
  });

  it("logs bounded anonymous reasons and aggregates without leaking URLs", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = failure({
      ok: true,
      error: null,
      latencyMs: 20,
      health: "warn",
      anonymousZen: {
        id: "node-a",
        status: "temporary_failure",
        reasonCode: "upstream_failure",
        ok: false,
        httpStatus: 503,
        latencyMs: 30001,
        error: "request to https://user:secret@example.invalid/private failed",
        testedAt: "2026-08-27T01:00:00.000Z",
        retryAfterSeconds: 30,
      },
    });
    logProbeFailure("batch", result);
    logBatchSummary([result], false);
    const output = [...warn.mock.calls, ...info.mock.calls].flat().join(" ");
    expect(output).toContain('"anonymousReasonCode":"upstream_failure"');
    expect(output).toContain('"anonymousRetryAfterSeconds":30');
    expect(output).toContain('"anonymousReasons":{"upstream_failure":1}');
    expect(output).toContain("[url]");
    expect(output).not.toContain("secret");
    expect(output).not.toContain("example.invalid");
    warn.mockRestore();
    info.mockRestore();
  });
});
