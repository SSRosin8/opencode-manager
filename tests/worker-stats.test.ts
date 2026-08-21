/**
 * Worker request / token usage stats.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseUsageFromObject,
  parseUsageFromSseBuffer,
  WorkerStatsStore,
} from "../src/settings/workerStats.js";
import type { UpstreamAttemptEvent } from "../src/proxy/upstream.js";

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("condition was not reached");
}

function attempt(
  overrides: Partial<UpstreamAttemptEvent> = {}
): UpstreamAttemptEvent {
  return {
    requestId: "req-1",
    operation: "chat",
    accountId: "worker-a",
    accountKind: "anonymous_zen",
    proxyId: "proxy-a",
    clashNodeName: null,
    model: "big-pickle",
    attempt: 1,
    maxAttempts: 2,
    status: 200,
    outcome: "success",
    error: null,
    latencyMs: 12,
    willRetry: false,
    at: "2026-08-19T01:00:00.000Z",
    ...overrides,
  };
}

describe("usage parsers", () => {
  it("parses usage nested in a Responses completed event", () => {
    expect(
      parseUsageFromObject({
        type: "response.completed",
        response: {
          usage: { input_tokens: 7, output_tokens: 4, total_tokens: 11 },
        },
      })
    ).toEqual({
      promptTokens: 7,
      completionTokens: 4,
      totalTokens: 11,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheMissTokens: 0,
    });
  });

  it("parses OpenAI usage object", () => {
    const u = parseUsageFromObject({
      id: "x",
      usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 },
    });
    expect(u).toEqual({
      promptTokens: 12,
      completionTokens: 34,
      totalTokens: 46,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheMissTokens: 0,
    });
  });

  it("accepts input/output token aliases", () => {
    const u = parseUsageFromObject({
      usage: { input_tokens: 5, output_tokens: 7 },
    });
    expect(u?.promptTokens).toBe(5);
    expect(u?.completionTokens).toBe(7);
    expect(u?.totalTokens).toBe(12);
  });

  it("parses OpenCode cache hit/miss fields from live response shape", () => {
    // Captured from real /v1/chat/completions via opencode-manager
    const u = parseUsageFromObject({
      id: "8b6126f5-03de-4e76-9207-91c07ef7940f",
      usage: {
        prompt_tokens: 577,
        completion_tokens: 21,
        total_tokens: 598,
        prompt_cache_hit_tokens: 0,
        prompt_cache_miss_tokens: 577,
        prompt_tokens_details: { cached_tokens: 0 },
        completion_tokens_details: { reasoning_tokens: 13 },
      },
    });
    expect(u).toEqual({
      promptTokens: 577,
      completionTokens: 21,
      totalTokens: 598,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheMissTokens: 577,
    });
  });

  it("parses cache read from hit + details.cached_tokens", () => {
    const u = parseUsageFromObject({
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 10,
        total_tokens: 1010,
        prompt_cache_hit_tokens: 800,
        prompt_cache_miss_tokens: 200,
        prompt_tokens_details: { cached_tokens: 800 },
      },
    });
    expect(u?.cacheReadTokens).toBe(800);
    expect(u?.cacheWriteTokens).toBe(0);
    expect(u?.cacheMissTokens).toBe(200);
  });

  it("keeps explicit cache writes separate from cache misses", () => {
    const u = parseUsageFromObject({
      usage: {
        prompt_tokens: 100,
        cache_creation_input_tokens: 30,
        prompt_cache_miss_tokens: 70,
      },
    });
    expect(u).toMatchObject({ cacheWriteTokens: 30, cacheMissTokens: 70 });
  });

  it("parses usage from SSE stream buffer", () => {
    const sse = [
      'data: {"id":"1","choices":[{"delta":{"content":"hi"}}]}',
      "",
      'data: {"id":"1","choices":[{"delta":{}}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12,"prompt_cache_hit_tokens":8,"prompt_cache_miss_tokens":2}}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    const u = parseUsageFromSseBuffer(sse);
    expect(u).toEqual({
      promptTokens: 10,
      completionTokens: 2,
      totalTokens: 12,
      cacheReadTokens: 8,
      cacheWriteTokens: 0,
      cacheMissTokens: 2,
    });
  });
});

describe("WorkerStatsStore", () => {
  it("accumulates requests and tokens", () => {
    const s = new WorkerStatsStore({ persist: false });
    s.recordRequest("w1", { kind: "chat", status: 200, model: "model-a" });
    s.recordRequest("w1", { kind: "chat", status: 200, model: "model-b" });
    s.recordRequest("w1", { kind: "models", status: 200 });
    s.addTokens("w1", {
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      cacheReadTokens: 40,
      cacheWriteTokens: 60,
      cacheMissTokens: 10,
    }, "model-a");
    const snap = s.get("w1");
    expect(snap.requestCount).toBe(3);
    expect(snap.chatCount).toBe(2);
    expect(snap.modelsCount).toBe(1);
    expect(snap.modelUsage).toEqual({ "model-a": 1, "model-b": 1 });
    expect(snap.modelAttemptUsage).toEqual({ "model-a": 1, "model-b": 1 });
    expect(snap.distinctModelCount).toBe(2);
    expect(snap.totalTokens).toBe(120);
    expect(snap.cacheReadTokens).toBe(40);
    expect(snap.cacheWriteTokens).toBe(60);
    expect(snap.cacheMissTokens).toBe(10);
    expect(snap.usageReportedCount).toBe(1);
    expect(snap.modelTokenUsage["model-a"]).toMatchObject({
      requestCount: 1,
      totalTokens: 120,
      cacheReadTokens: 40,
      cacheWriteTokens: 60,
      cacheMissTokens: 10,
    });
    expect(snap.cacheRate).toBeCloseTo(0.4);
    expect(s.totals(["w1"]).totalTokens).toBe(120);
    expect(s.totals(["w1"]).cacheRate).toBeCloseTo(0.4);
  });

  it("returns zero totals for an explicitly empty account group", () => {
    const s = new WorkerStatsStore({ persist: false });
    s.recordRequest("historical", { kind: "chat", status: 200 });

    expect(s.totals([]).requestCount).toBe(0);
    expect(s.listForAccounts([])).toEqual([]);
    expect(s.getAll()).toHaveLength(1);
  });

  it("records upstream attempts and aggregates only chat/models operations", () => {
    const s = new WorkerStatsStore({ persist: false });
    s.recordAttempt(
      attempt(),
      {
        proxyName: "US node",
        egressIp: "203.0.113.9",
        credentialLabel: "anonymous public",
      }
    );
    s.recordAttempt(
      attempt({
        requestId: "req-2",
        operation: "models",
        status: null,
        outcome: "transport_error",
        error: "connect timeout",
        at: "2026-08-19T01:01:00.000Z",
      })
    );
    s.recordAttempt(
      attempt({
        requestId: "req-3",
        operation: "test",
        at: "2026-08-19T01:02:00.000Z",
      })
    );

    const snapshot = s.get("worker-a");
    expect(snapshot).toMatchObject({
      requestCount: 2,
      chatCount: 1,
      modelsCount: 1,
      modelUsage: { "big-pickle": 1 },
      modelAttemptUsage: { "big-pickle": 1 },
      distinctModelCount: 1,
      successCount: 1,
      errorCount: 1,
      lastStatus: null,
      lastRequestAt: "2026-08-19T01:01:00.000Z",
    });
    expect(s.recentAttempts().map((item) => item.requestId)).toEqual([
      "req-3",
      "req-2",
      "req-1",
    ]);
    expect(s.recentAttempts()[2]).toMatchObject({
      proxyName: "US node",
      egressIp: "203.0.113.9",
      credentialLabel: "anonymous public",
    });
  });

  it("counts one logical generation and model use across a retry chain", () => {
    const s = new WorkerStatsStore({ persist: false });
    s.recordAttempt(attempt({
      accountId: "worker-a",
      status: 500,
      outcome: "upstream_error",
      willRetry: true,
    }));
    s.recordAttempt(attempt({
      accountId: "worker-b",
      attempt: 2,
      status: 200,
      outcome: "success",
      willRetry: false,
    }));
    s.addTokens("worker-b", {
      promptTokens: 8,
      completionTokens: 2,
      totalTokens: 10,
      cacheReadTokens: 4,
      cacheWriteTokens: 0,
      cacheMissTokens: 4,
    }, "big-pickle");

    const totals = s.totals();
    expect(totals.requestCount).toBe(2);
    expect(totals.generationRequestCount).toBe(1);
    expect(totals.generationAttemptCount).toBe(2);
    expect(totals.generationSuccessCount).toBe(1);
    expect(totals.generationErrorCount).toBe(1);
    expect(totals.generationCompletedSuccessCount).toBe(1);
    expect(totals.generationCompletedErrorCount).toBe(0);
    expect(totals.modelUsage).toEqual({ "big-pickle": 1 });
    expect(totals.modelAttemptUsage).toEqual({ "big-pickle": 2 });
    expect(s.get("worker-a").modelAttemptUsage).toEqual({ "big-pickle": 1 });
    expect(s.get("worker-b").modelAttemptUsage).toEqual({ "big-pickle": 1 });
    expect(s.get("worker-a").modelTokenUsage).toEqual({});
    expect(s.get("worker-b").modelTokenUsage["big-pickle"]?.totalTokens).toBe(10);
  });

  it("does not count redirects as successful upstream attempts", () => {
    const s = new WorkerStatsStore({ persist: false });
    s.recordAttempt(attempt({ status: 302, outcome: "upstream_error" }));
    expect(s.get("worker-a")).toMatchObject({ successCount: 0, errorCount: 1 });
  });

  it("tracks responses whose provider omitted usage", () => {
    const s = new WorkerStatsStore({ persist: false });
    s.recordMissingUsage("worker-a");
    expect(s.get("worker-a")).toMatchObject({ usageReportedCount: 0, usageMissingCount: 1 });
  });

  it("caps attempt history at 200 entries and resets by worker", async () => {
    const s = new WorkerStatsStore({ persist: false });
    for (let i = 0; i < 205; i += 1) {
      s.recordAttempt(
        attempt({
          requestId: `req-${i}`,
          accountId: i === 204 ? "worker-b" : "worker-a",
        })
      );
    }

    expect(s.recentAttempts(500)).toHaveLength(200);
    expect(s.recentAttempts(500).at(-1)?.requestId).toBe("req-5");
    await s.reset("worker-b");
    expect(s.recentAttempts().some((item) => item.accountId === "worker-b")).toBe(false);
    expect(s.get("worker-b").requestCount).toBe(0);
  });

  it("persists and reloads", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opencode-manager-ws-"));
    try {
      const path = join(dir, "stats.json");
      const a = new WorkerStatsStore({ path, persist: true });
      a.recordRequest("acc", { kind: "chat", status: 200 });
      a.recordAttempt(
        attempt({ accountId: "acc", requestId: "persisted-attempt" }),
        { egressIp: "198.51.100.7", credentialLabel: "Zen abcd...wxyz" }
      );
      a.addTokens("acc", {
        promptTokens: 3,
        completionTokens: 4,
        totalTokens: 7,
        cacheReadTokens: 1,
        cacheWriteTokens: 2,
        cacheMissTokens: 3,
      }, "big-pickle");
      await a.persist();
      const b = new WorkerStatsStore({ path, persist: true });
      await b.load();
      expect(b.get("acc").totalTokens).toBe(7);
      expect(b.get("acc").chatCount).toBe(2);
      expect(b.get("acc").modelUsage).toEqual({ "big-pickle": 1 });
      expect(b.get("acc").modelAttemptUsage).toEqual({ "big-pickle": 1 });
      expect(b.get("acc").distinctModelCount).toBe(1);
      expect(b.get("acc").cacheReadTokens).toBe(1);
      expect(b.get("acc").cacheWriteTokens).toBe(2);
      expect(b.get("acc").cacheMissTokens).toBe(3);
      expect(b.get("acc").modelTokenUsage["big-pickle"]?.totalTokens).toBe(7);
      expect(b.recentAttempts()).toEqual([
        expect.objectContaining({
          requestId: "persisted-attempt",
          egressIp: "198.51.100.7",
          credentialLabel: "Zen abcd...wxyz",
        }),
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("serializes an in-flight snapshot before a reset snapshot", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opencode-manager-ws-queue-"));
    try {
      const writes: string[] = [];
      const releases: Array<() => void> = [];
      const s = new WorkerStatsStore({
        path: join(dir, "stats.json"),
        persist: true,
        writeFile: async (_path, data) => {
          writes.push(data);
          await new Promise<void>((resolve) => releases.push(resolve));
        },
      });
      s.recordRequest("acc", { kind: "chat", status: 200 });
      const firstWrite = s.persist();
      await waitFor(() => releases.length === 1);

      const reset = s.reset();
      expect(writes).toHaveLength(1);
      releases.shift()?.();
      await firstWrite;
      await waitFor(() => releases.length === 1 && writes.length === 2);

      const resetPayload = JSON.parse(writes[1]) as { workers: object; attempts: unknown[] };
      expect(resetPayload).toEqual({ workers: {}, attempts: [] });
      releases.shift()?.();
      await reset;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("close flushes a pending debounced save and is idempotent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opencode-manager-ws-close-"));
    try {
      const path = join(dir, "stats.json");
      const a = new WorkerStatsStore({ path, persist: true });
      a.recordRequest("acc", { kind: "chat", status: 200 });
      const closing = a.close();
      expect(a.close()).toBe(closing);
      await closing;

      const b = new WorkerStatsStore({ path, persist: true });
      await b.load();
      expect(b.get("acc")).toMatchObject({ requestCount: 1, successCount: 1 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("loads legacy persisted stats without an attempts field", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opencode-manager-ws-legacy-"));
    try {
      const path = join(dir, "stats.json");
      await writeFile(
        path,
        JSON.stringify({
          workers: {
            legacy: {
              requestCount: 3,
              chatCount: 3,
              successCount: 2,
              errorCount: 1,
              totalTokens: 9,
            },
          },
        })
      );
      const s = new WorkerStatsStore({ path, persist: true });
      await s.load();
      expect(s.get("legacy").requestCount).toBe(3);
      expect(s.get("legacy").modelUsage).toEqual({});
      expect(s.get("legacy").distinctModelCount).toBe(0);
      expect(s.get("legacy").generationRequestCount).toBe(3);
      expect(s.recentAttempts()).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
