/**
 * Worker request / token usage stats.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseUsageFromObject,
  parseUsageFromSseBuffer,
  WorkerStatsStore,
} from "../src/settings/workerStats.js";
import { createApp, close, listen, type App } from "../src/server/http.js";
import { SettingsStore } from "../src/settings/store.js";
import type { UpstreamAttemptEvent } from "../src/proxy/upstream.js";
import { ProbeResultCache } from "../src/proxy/probe.js";

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
      cacheWriteTokens: 577,
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
    expect(u?.cacheWriteTokens).toBe(200);
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
      cacheWriteTokens: 2,
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
    });
    const snap = s.get("w1");
    expect(snap.requestCount).toBe(3);
    expect(snap.chatCount).toBe(2);
    expect(snap.modelsCount).toBe(1);
    expect(snap.modelUsage).toEqual({ "model-a": 1, "model-b": 1 });
    expect(snap.distinctModelCount).toBe(2);
    expect(snap.totalTokens).toBe(120);
    expect(snap.cacheReadTokens).toBe(40);
    expect(snap.cacheWriteTokens).toBe(60);
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
      });
      await a.persist();
      const b = new WorkerStatsStore({ path, persist: true });
      await b.load();
      expect(b.get("acc").totalTokens).toBe(7);
      expect(b.get("acc").chatCount).toBe(2);
      expect(b.get("acc").modelUsage).toEqual({ "big-pickle": 1 });
      expect(b.get("acc").distinctModelCount).toBe(1);
      expect(b.get("acc").cacheReadTokens).toBe(1);
      expect(b.get("acc").cacheWriteTokens).toBe(2);
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
      expect(s.recentAttempts()).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("worker stats HTTP", () => {
  let app: App | null = null;
  let dir = "";

  afterEach(async () => {
    if (app) await close(app);
    app = null;
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = "";
  });

  it("counts chat requests and tokens on status", async () => {
    dir = await mkdtemp(join(tmpdir(), "opencode-manager-ws-http-"));
    const store = new SettingsStore(join(dir, "settings.json"));
    await store.save({
      baseUrl: "https://opencode.ai/zen/v1",
      accounts: [
        { id: "worker-a", apiKey: "ka", proxyId: null, proxy: null },
        { id: "worker-b", apiKey: "kb", proxyId: null, proxy: null },
      ],
      proxyPool: [],
      proxySubscriptions: [],
      clashBridge: {
        enabled: false,
        apiBase: "http://127.0.0.1:9090",
        apiSecret: "",
        localProxyHost: "127.0.0.1",
        localProxyPort: 7890,
        selectorGroup: "GLOBAL",
      },
    });
    const workerStats = new WorkerStatsStore({
      path: join(dir, "worker-stats.json"),
      persist: true,
    });
    app = await createApp({
      store,
      port: 0,
      workerStats,
      fetchImpl: async (url) => {
        if (String(url).includes("chat/completions")) {
          return new Response(
            JSON.stringify({
              id: "c1",
              choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
              usage: {
                prompt_tokens: 11,
                completion_tokens: 9,
                total_tokens: 20,
                prompt_cache_hit_tokens: 4,
                prompt_cache_miss_tokens: 7,
                prompt_tokens_details: { cached_tokens: 4 },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (String(url).includes("/models")) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        return new Response("nope", { status: 404 });
      },
    });
    await listen(app);
    const addr = app.server.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");
    const base = `http://127.0.0.1:${addr.port}`;

    const chat = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "big-pickle",
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(chat.status).toBe(200);
    const chatBody = (await chat.json()) as { usage: { total_tokens: number } };
    expect(chatBody.usage.total_tokens).toBe(20);

    await fetch(`${base}/v1/models`);

    const st = (await (await fetch(`${base}/admin/api/status`)).json()) as {
      workers: Array<{
        accountId: string;
        requestCount: number;
        chatCount: number;
        modelsCount: number;
        modelUsage: Record<string, number>;
        distinctModelCount: number;
        totalTokens: number;
        promptTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
        cacheRate: number | null;
      }>;
      usageTotals: {
        requestCount: number;
        totalTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
        cacheRate: number | null;
      };
    };

    const used = st.workers.filter((w) => w.requestCount > 0);
    expect(used.length).toBeGreaterThanOrEqual(1);
    const sumReq = st.workers.reduce((a, w) => a + w.requestCount, 0);
    expect(sumReq).toBeGreaterThanOrEqual(2);
    expect(st.usageTotals.totalTokens).toBe(20);
    expect(st.usageTotals.requestCount).toBe(sumReq);
    expect(st.usageTotals.cacheReadTokens).toBe(4);
    expect(st.usageTotals.cacheWriteTokens).toBe(7);
    expect(st.usageTotals.cacheRate).toBeCloseTo(4 / 11);
    expect(st.workers.some((w) => w.modelUsage["big-pickle"] === 1)).toBe(true);
    expect(st.workers.some((w) => w.distinctModelCount === 1)).toBe(true);

    // reset
    const reset = await fetch(`${base}/admin/api/worker-stats/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(reset.status).toBe(200);
    const after = (await (await fetch(`${base}/admin/api/status`)).json()) as {
      usageTotals: { requestCount: number; totalTokens: number };
    };
    expect(after.usageTotals.requestCount).toBe(0);
    expect(after.usageTotals.totalTokens).toBe(0);
  });

  it("shows the failed egress and the successful Zen key in one retry chain", async () => {
    dir = await mkdtemp(join(tmpdir(), "opencode-manager-ws-retry-"));
    const store = new SettingsStore(join(dir, "settings.json"));
    await store.save({
      accounts: [
        { id: "worker-us", kind: "authenticated_zen", apiKey: "zen-key-america", proxyId: "proxy-us" },
        { id: "worker-mx", kind: "authenticated_zen", apiKey: "zen-key-mexico", proxyId: "proxy-mx" },
      ],
      proxyPool: [
        { id: "proxy-us", name: "US unavailable", type: "http", host: "192.0.2.10", port: 8080, enabled: true, source: "manual", usable: true, bridgeable: true },
        { id: "proxy-mx", name: "Mexico available", type: "http", host: "192.0.2.11", port: 8080, enabled: true, source: "manual", usable: true, bridgeable: true },
      ],
    });
    const probes = new ProbeResultCache();
    probes.setMany([
      { id: "proxy-us", ok: true, latencyMs: 10, error: null, testedAt: new Date().toISOString(), health: "healthy", egressIp: "203.0.113.10" },
      { id: "proxy-mx", ok: true, latencyMs: 20, error: null, testedAt: new Date().toISOString(), health: "healthy", egressIp: "203.0.113.11" },
    ]);
    let call = 0;
    app = await createApp({
      store,
      probes,
      port: 0,
      fetchImpl: async () => {
        call++;
        if (call === 1) throw new Error("connect timeout to US proxy");
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    await listen(app);
    const addr = app.server.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");
    const base = `http://127.0.0.1:${addr.port}`;

    const chat = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "big-pickle", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(chat.status).toBe(200);

    const status = (await (await fetch(`${base}/admin/api/status`)).json()) as {
      workers: Array<{ accountId: string; successCount: number; errorCount: number; proxyName: string; egressIp: string; credentialLabel: string }>;
      recentAttempts: Array<{ requestId: string; accountId: string; outcome: string; willRetry: boolean; proxyName: string; egressIp: string; credentialLabel: string }>;
    };
    expect(status.recentAttempts).toHaveLength(2);
    expect(new Set(status.recentAttempts.map((item) => item.requestId)).size).toBe(1);
    expect(status.recentAttempts).toEqual([
      expect.objectContaining({ accountId: "worker-mx", outcome: "success", willRetry: false, proxyName: "Mexico available", egressIp: "203.0.113.11", credentialLabel: "zen-...xico" }),
      expect.objectContaining({ accountId: "worker-us", outcome: "transport_error", willRetry: true, proxyName: "US unavailable", egressIp: "203.0.113.10", credentialLabel: "zen-...rica" }),
    ]);
    expect(status.workers.find((item) => item.accountId === "worker-us")).toMatchObject({ errorCount: 1, successCount: 0, proxyName: "US unavailable", egressIp: "203.0.113.10" });
    expect(status.workers.find((item) => item.accountId === "worker-mx")).toMatchObject({ errorCount: 0, successCount: 1, proxyName: "Mexico available", egressIp: "203.0.113.11" });
  });
});
