/** Worker statistics exposed through the admin status API. */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProbeResultCache } from "../src/proxy/probe.js";
import type { UpstreamAttemptEvent } from "../src/proxy/upstream.js";
import { close, createApp, listen, type App } from "../src/server/http.js";
import { SettingsStore } from "../src/settings/store.js";
import { WorkerStatsStore } from "../src/settings/workerStats.js";

function attempt(overrides: Partial<UpstreamAttemptEvent> = {}): UpstreamAttemptEvent {
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
    const status = (await (await fetch(`${base}/admin/api/status`)).json()) as {
      workers: Array<{
        requestCount: number;
        modelUsage: Record<string, number>;
        distinctModelCount: number;
      }>;
      usageTotals: {
        requestCount: number;
        totalTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
        cacheMissTokens: number;
        cacheRate: number | null;
      };
      usageTotalsByKind: {
        anonymous_zen: { requestCount: number };
        authenticated_zen: { requestCount: number };
      };
    };

    const used = status.workers.filter((worker) => worker.requestCount > 0);
    expect(used.length).toBeGreaterThanOrEqual(1);
    const requestCount = status.workers.reduce((sum, worker) => sum + worker.requestCount, 0);
    expect(requestCount).toBeGreaterThanOrEqual(2);
    expect(status.usageTotals).toMatchObject({
      requestCount,
      totalTokens: 20,
      cacheReadTokens: 4,
      cacheWriteTokens: 0,
      cacheMissTokens: 7,
    });
    expect(status.usageTotals.cacheRate).toBeCloseTo(4 / 11);
    expect(status.usageTotalsByKind.authenticated_zen.requestCount).toBe(requestCount);
    expect(status.usageTotalsByKind.anonymous_zen.requestCount).toBe(0);
    expect(status.workers.some((worker) => worker.modelUsage["big-pickle"] === 1)).toBe(true);
    expect(status.workers.some((worker) => worker.distinctModelCount === 1)).toBe(true);

    const reset = await fetch(`${base}/admin/api/worker-stats/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(reset.status).toBe(200);
    const after = (await (await fetch(`${base}/admin/api/status`)).json()) as {
      usageTotals: { requestCount: number; totalTokens: number };
    };
    expect(after.usageTotals).toMatchObject({ requestCount: 0, totalTokens: 0 });
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
        call += 1;
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
      workers: Array<{ accountId: string }>;
      recentAttempts: Array<{ requestId: string; accountId: string }>;
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

  it("keeps the latest measured egress visible when the probe cache is empty", async () => {
    dir = await mkdtemp(join(tmpdir(), "opencode-manager-ws-egress-"));
    const store = new SettingsStore(join(dir, "settings.json"));
    await store.save({
      accounts: [{ id: "worker-a", apiKey: "", proxyId: "proxy-a" }],
      proxyPool: [{ id: "proxy-a", name: "Singapore", type: "http", host: "192.0.2.20", port: 8080, enabled: true, source: "manual", usable: true, bridgeable: true }],
    });
    const stats = new WorkerStatsStore({ persist: false });
    stats.recordAttempt(attempt(), { egressIp: "203.0.113.42", proxyName: "Singapore" });
    app = await createApp({ store, workerStats: stats, probes: new ProbeResultCache(), port: 0 });
    await listen(app);
    const addr = app.server.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");

    const status = (await (await fetch(`http://127.0.0.1:${addr.port}/admin/api/status`)).json()) as {
      workers: Array<{ accountId: string; egressIp: string | null }>;
    };
    expect(status.workers.find((worker) => worker.accountId === "worker-a")?.egressIp).toBe("203.0.113.42");
  });

  it("uses the persisted proxy exit after both in-memory caches are empty", async () => {
    dir = await mkdtemp(join(tmpdir(), "opencode-manager-ws-persisted-egress-"));
    const store = new SettingsStore(join(dir, "settings.json"));
    await store.save({
      accounts: [{ id: "worker-a", apiKey: "", proxyId: "proxy-a" }],
      proxyPool: [{ id: "proxy-a", name: "Singapore", type: "http", host: "192.0.2.20", port: 8080, enabled: true, source: "manual", usable: true, bridgeable: true, egressIp: "203.0.113.77" }],
    });
    const stats = new WorkerStatsStore({ persist: false });
    stats.recordAttempt(attempt(), { egressIp: null, proxyName: "Singapore" });
    app = await createApp({
      store,
      workerStats: stats,
      probes: new ProbeResultCache(),
      port: 0,
    });
    await listen(app);
    const addr = app.server.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");

    const status = (await (await fetch(`http://127.0.0.1:${addr.port}/admin/api/status`)).json()) as {
      workers: Array<{ accountId: string; egressIp: string | null }>;
      recentAttempts: Array<{ egressIp: string | null }>;
    };
    expect(status.workers.find((worker) => worker.accountId === "worker-a")?.egressIp).toBe("203.0.113.77");
    expect(status.recentAttempts[0].egressIp).toBe("203.0.113.77");
  });
});
