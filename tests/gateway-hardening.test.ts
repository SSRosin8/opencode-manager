import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AccountRotator, DEFAULT_RATE_LIMIT_COOLDOWN_MS } from "../src/relay/accounts.js";
import { DEFAULT_BASE_URL, normalizeBaseUrl } from "../src/relay/url.js";
import { close, createApp, listen } from "../src/server/http.js";
import type { App } from "../src/server/http.js";
import { FreeModelRegistry } from "../src/proxy/freeModels.js";
import { ProbeStateStore } from "../src/settings/probeState.js";
import { newBatchProbeProgress } from "../src/server/context.js";
import { SettingsStore } from "../src/settings/store.js";

let app: App | null = null;

afterEach(async () => {
  if (app) {
    await close(app).catch(() => undefined);
    app = null;
  }
});

function baseSettings(dir: string) {
  return {
    relayAccessToken: "",
    baseUrl: "https://opencode.ai/zen/v1",
    accounts: [{ id: "a1", apiKey: "test-key-aaa", kind: "authenticated_zen" as const, proxyId: null, proxy: null }],
    proxyPool: [],
    proxySubscriptions: [],
    clashBridge: {
      enabled: false, apiBase: "http://127.0.0.1:9090", apiSecret: "",
      localProxyHost: "127.0.0.1", localProxyPort: 7890, selectorGroup: "GLOBAL",
      selectionMode: "auto" as const, bridges: [], activeBridgeId: null,
    },
    freeModelsPath: join(dir, "free-models.json"),
  };
}

async function boot(dir: string, overrides: Record<string, unknown> = {}) {
  const store = new SettingsStore(join(dir, "settings.json"));
  await store.save({ ...baseSettings(dir), ...overrides } as never);
  app = await createApp({
    store,
    port: 0,
    fetchImpl: async () => new Response(JSON.stringify({ object: "list", data: [] }), { status: 200 }),
    freeModels: new FreeModelRegistry({ cachePath: join(dir, "free-models.json") }),
  });
  await listen(app);
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  return { port: addr.port, store };
}

describe("gateway hardening", () => {
  it("persists settings.json with owner-only permissions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opencode-hardening-"));
    try {
      const store = new SettingsStore(join(dir, "settings.json"));
      await store.save({ relayAccessToken: "relay-secret-xyz" });
      const mode = (await stat(join(dir, "settings.json"))).mode & 0o777;
      expect(mode).toBe(0o600);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects non-http(s) baseUrl back to the default", () => {
    expect(normalizeBaseUrl("file:///etc/passwd")).toBe(DEFAULT_BASE_URL);
    expect(normalizeBaseUrl("gopher://example.com")).toBe(DEFAULT_BASE_URL);
    expect(normalizeBaseUrl("not-a-url")).toBe(DEFAULT_BASE_URL);
    expect(normalizeBaseUrl("https://opencode.ai/zen/v1/")).toBe("https://opencode.ai/zen/v1");
    expect(normalizeBaseUrl("https://user:pass@opencode.ai/zen/v1")).toBe(DEFAULT_BASE_URL);
    expect(normalizeBaseUrl("https://opencode.ai/zen/v1?token=secret")).toBe(DEFAULT_BASE_URL);
  });

  it("rejects non-http subscription urls without fetching", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opencode-hardening-"));
    try {
      const { port } = await boot(dir);
      for (const url of ["file:///etc/passwd", "gopher://example.com/x", "ftp://example.com/f"]) {
        const res = await fetch(`http://127.0.0.1:${port}/admin/api/proxy-subscriptions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: { type: "invalid_subscription_url" } });
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns 413 for oversized admin bodies", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opencode-hardening-"));
    try {
      const { port } = await boot(dir);
      const res = await fetch(`http://127.0.0.1:${port}/admin/api/proxy-pool`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: "x".repeat(2 * 1024 * 1024), port: 8080 }),
      });
      expect(res.status).toBe(413);
      expect(await res.json()).toMatchObject({ error: { type: "body_too_large" } });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps the existing pool when a subscription parses 0 nodes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opencode-hardening-"));
    try {
      const store = new SettingsStore(join(dir, "settings.json"));
      await store.save({
        ...baseSettings(dir),
        proxyPool: [{
          id: "px_keep", name: "keep", type: "http", host: "203.0.113.9", port: 8080,
          enabled: true, source: "subscription", subscriptionId: "sub_1", usable: true,
        }],
        proxySubscriptions: [{
          id: "sub_1", name: "s", url: "https://example.com/sub", enabled: true,
          lastFetchedAt: null, lastError: null, lastImportCount: 1,
        }],
      } as never);
      app = await createApp({
        store,
        port: 0,
        fetchImpl: async () => new Response("{}", { status: 200 }),
        subscriptionFetch: (async () => new Response("not-a-proxy-list", {
          status: 200, headers: { "Content-Type": "text/plain" },
        })) as typeof fetch,
        freeModels: new FreeModelRegistry({ cachePath: join(dir, "free-models.json") }),
      });
      await listen(app);
      const addr = app.server.address();
      if (!addr || typeof addr === "string") throw new Error("no address");
      const res = await fetch(
        `http://127.0.0.1:${addr.port}/admin/api/proxy-subscriptions/sub_1/fetch`,
        { method: "POST" }
      );
      expect(res.status).toBe(200);
      const poolRes = await fetch(`http://127.0.0.1:${addr.port}/admin/api/proxy-pool`);
      const pool = (await poolRes.json()) as { proxyPool: Array<{ id: string }> };
      expect(pool.proxyPool.map((p) => p.id)).toContain("px_keep");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not leak raw internals on unhandled errors", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opencode-hardening-"));
    try {
      const { port } = await boot(dir);
      // Unknown admin route with a throwing handler path still maps to 404/500 shapes,
      // never echoing proxy host:port or controller urls.
      const res = await fetch(`http://127.0.0.1:${port}/admin/api/does-not-exist`);
      expect(res.status).toBe(404);
      const body = await res.text();
      expect(body).not.toContain("127.0.0.1:9090");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("cools down 401 briefly instead of the 15-minute rate-limit penalty", () => {
    const rotator = new AccountRotator();
    rotator.sync([{ id: "bad", apiKey: "bad-key", kind: "authenticated_zen" }]);
    const [account] = rotator.getAccounts();
    const now = Date.now();
    rotator.markAuthFailed(account, now, 0);
    expect(account.cooldownUntil - now).toBeLessThan(DEFAULT_RATE_LIMIT_COOLDOWN_MS);
    expect(account.cooldownUntil - now).toBeGreaterThan(0);
  });

  it("picks the earliest-recovering worker when all are cooling down", () => {
    const rotator = new AccountRotator();
    rotator.sync([
      { id: "slow", apiKey: "k1", kind: "authenticated_zen" },
      { id: "fast", apiKey: "k2", kind: "authenticated_zen" },
    ]);
    const now = Date.now();
    const byId = new Map(rotator.getAccounts().map((a) => [a.id, a] as const));
    byId.get("slow")!.cooldownUntil = now + 60_000;
    byId.get("fast")!.cooldownUntil = now + 1_000;
    expect(rotator.pick("", now).id).toBe("fast");
  });

  it("never drops the latest probe state under rapid saves", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opencode-hardening-"));
    try {
      const state = new ProbeStateStore(join(dir, "settings.json"));
      const mkProgress = (completed: number) => ({
        ...newBatchProbeProgress(), running: true, total: 3, completed,
        completedIds: Array.from({ length: completed }, (_, i) => `px${i + 1}`),
      });
      await Promise.all([
        state.save([], mkProgress(1)),
        state.save([], mkProgress(2)),
        state.save([], mkProgress(3)),
      ]);
      const loaded = await state.load(new Set(["px1", "px2", "px3"]), newBatchProbeProgress());
      expect(loaded.batchProbe.completed).toBe(3);
      expect(loaded.batchProbe.completedIds).toEqual(["px1", "px2", "px3"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("realigns completed/total after pool entries are deleted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opencode-hardening-"));
    try {
      const state = new ProbeStateStore(join(dir, "settings.json"));
      await state.save([], {
        ...newBatchProbeProgress(),
        running: false, total: 3, completed: 3,
        completedIds: ["px1", "px2", "px3"],
      });
      const loaded = await state.load(new Set(["px1"]), newBatchProbeProgress());
      expect(loaded.batchProbe.completedIds).toEqual(["px1"]);
      expect(loaded.batchProbe.completed).toBe(1);
      expect(loaded.batchProbe.total).toBeLessThanOrEqual(3);
      expect(loaded.batchProbe.completed).toBeLessThanOrEqual(loaded.batchProbe.total);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
