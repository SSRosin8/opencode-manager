/**
 * Proxy latency probe unit + HTTP API tests.
 */
import { describe, expect, it, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  probePoolProxy,
  probePoolProxies,
  summarizeProbeResults,
  ProbeResultCache,
} from "../src/proxy/probe.js";
import type { PoolProxy } from "../src/proxy/pool.js";
import { SettingsStore, type GatewaySettings } from "../src/settings/store.js";
import { createApp, close, listen, type App } from "../src/server/http.js";

function px(over: Partial<PoolProxy> & Pick<PoolProxy, "id" | "name" | "type" | "host" | "port">): PoolProxy {
  return {
    enabled: true,
    source: "manual",
    usable: true,
    bridgeable: true,
    ...over,
  };
}

const bridgeOff = {
  enabled: false,
  apiBase: "http://127.0.0.1:9090",
  apiSecret: "",
  localProxyHost: "127.0.0.1",
  localProxyPort: 7890,
  selectorGroup: "GLOBAL",
};

const bridgeOn = { ...bridgeOff, enabled: true };

describe("probePoolProxy", () => {
  it("skips disabled nodes", async () => {
    const r = await probePoolProxy(
      px({ id: "a", name: "a", type: "http", host: "1.1.1.1", port: 80, enabled: false }),
      bridgeOff
    );
    expect(r.skipped).toBe(true);
    expect(r.health).toBe("bad");
    expect(r.reason).toBe("disabled");
  });

  it("marks bridgeable nodes without bridge as warn/skip", async () => {
    const r = await probePoolProxy(
      px({
        id: "v",
        name: "vless-1",
        type: "vless",
        host: "1.2.3.4",
        port: 443,
        usable: false,
        bridgeable: true,
      }),
      bridgeOff
    );
    expect(r.skipped).toBe(true);
    expect(r.health).toBe("warn");
    expect(r.reason).toBe("bridge_required");
    expect(r.latencyMs).toBeNull();
  });

  it("measures latency for direct proxy via fetchImpl", async () => {
    const r = await probePoolProxy(
      px({ id: "h", name: "http-1", type: "http", host: "10.0.0.1", port: 8080 }),
      bridgeOff,
      {
        timeoutMs: 2000,
        fetchImpl: async () => {
          await new Promise((r) => setTimeout(r, 15));
          return new Response(null, { status: 204 });
        },
      }
    );
    expect(r.ok).toBe(true);
    expect(r.health).toBe("healthy");
    expect(r.latencyMs).toBeGreaterThanOrEqual(10);
    expect(r.error).toBeNull();
  });

  it("records the public egress IP returned by the probe endpoint", async () => {
    const r = await probePoolProxy(
      px({ id: "ip", name: "ip", type: "http", host: "10.0.0.1", port: 8080 }),
      bridgeOff,
      { fetchImpl: async () => new Response("203.0.113.9", { status: 200 }) }
    );
    expect(r.ok).toBe(true);
    expect(r.egressIp).toBe("203.0.113.9");
  });

  it("returns Timeout on abort", async () => {
    const r = await probePoolProxy(
      px({ id: "t", name: "slow", type: "http", host: "10.0.0.2", port: 8080 }),
      bridgeOff,
      {
        timeoutMs: 30,
        fetchImpl: async (_url, init) => {
          await new Promise<void>((resolve, reject) => {
            const t = setTimeout(resolve, 500);
            init?.signal?.addEventListener("abort", () => {
              clearTimeout(t);
              reject(new Error("The operation was aborted"));
            });
          });
          return new Response(null, { status: 204 });
        },
      }
    );
    expect(r.ok).toBe(false);
    expect(r.health).toBe("bad");
    expect(r.error).toBe("Timeout");
  });

  it("switches Clash then probes bridged node", async () => {
    const switches: string[] = [];
    const r = await probePoolProxy(
      px({
        id: "b",
        name: "Tokyo-HY2",
        type: "hysteria2",
        host: "45.1.2.3",
        port: 443,
        usable: false,
        bridgeable: true,
        clashNodeName: "Tokyo-HY2",
      }),
      bridgeOn,
      {
        bridgeFetch: (async (url: string, init?: RequestInit) => {
          if (String(url).includes("/proxies/") && init?.method === "PUT") {
            switches.push(String(url));
            return new Response(null, { status: 204 });
          }
          if (String(url).endsWith("/proxies")) {
            return new Response(
              JSON.stringify({
                proxies: {
                  GLOBAL: { type: "Selector", all: ["Tokyo-HY2"] },
                },
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
          return new Response(null, { status: 404 });
        }) as typeof fetch,
        fetchImpl: async () => new Response(null, { status: 204 }),
      }
    );
    expect(r.ok).toBe(true);
    expect(r.latencyMs).not.toBeNull();
    expect(switches.length).toBeGreaterThanOrEqual(1);
  });
});

describe("probePoolProxies", () => {
  it("summarizes mixed results", async () => {
    const list = [
      px({ id: "ok", name: "ok", type: "http", host: "1.1.1.1", port: 80 }),
      px({
        id: "need",
        name: "need",
        type: "vless",
        host: "2.2.2.2",
        port: 443,
        usable: false,
        bridgeable: true,
      }),
      px({ id: "off", name: "off", type: "http", host: "3.3.3.3", port: 80, enabled: false }),
    ];
    const results = await probePoolProxies(list, bridgeOff, {
      fetchImpl: async () => new Response(null, { status: 204 }),
    });
    expect(results).toHaveLength(3);
    const sum = summarizeProbeResults(results);
    expect(sum.ok).toBe(1);
    expect(sum.skip).toBe(2);
  });

  it("screens Controller nodes quickly and verifies bound nodes first", async () => {
    const calls: string[] = [];
    const list = ["Mexico", "Japan", "Germany"].map((name, index) =>
      px({
        id: `c${index}`,
        name,
        type: "anytls",
        host: "127.0.0.1",
        port: 17891,
        source: "controller",
        usable: false,
        bridgeable: true,
        clashNodeName: name,
      })
    );
    const results = await probePoolProxies(list, { ...bridgeOn, selectorGroup: "Proxy" }, {
      fastController: true,
      verifyEgressCount: 1,
      verifyProxyIds: ["c2"],
      bridgeFetch: (async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method || "GET"} ${url}`);
        return new Response(JSON.stringify({ delay: 100 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch,
      fetchImpl: async () => new Response("203.0.113.30", { status: 200 }),
    });
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results[2].egressIp).toBe("203.0.113.30");
    expect(results.slice(0, 2).every((result) => result.egressIp === null)).toBe(true);
    expect(calls.filter((call) => call.startsWith("GET ") && call.includes("/delay?"))).toHaveLength(3);
    expect(calls.some((call) => call.startsWith("PUT ") && call.includes("/proxies/Proxy"))).toBe(true);
  });
});

describe("ProbeResultCache", () => {
  it("stores and deletes", () => {
    const c = new ProbeResultCache();
    c.set({
      id: "x",
      ok: true,
      latencyMs: 12,
      error: null,
      testedAt: new Date().toISOString(),
      health: "healthy",
    });
    expect(c.get("x")?.latencyMs).toBe(12);
    c.delete("x");
    expect(c.get("x")).toBeUndefined();
  });
});

describe("admin proxy probe HTTP APIs", () => {
  let app: App | null = null;
  let dir = "";

  afterEach(async () => {
    if (app) await close(app);
    app = null;
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = "";
  });

  async function boot(pool: PoolProxy[]) {
    dir = await mkdtemp(join(tmpdir(), "ocfr-probe-"));
    const store = new SettingsStore(join(dir, "settings.json"));
    const base: GatewaySettings = {
      baseUrl: "https://opencode.ai/zen/v1",
      synthesizeCliHeaders: false,
      cliUserAgent: "opencode-cli/1.0.0",
      cliClient: "cli",
      cliProject: "default",
      accounts: [{ id: "w1", apiKey: "k1", proxyId: null, proxy: null }],
      proxyPool: pool,
      proxySubscriptions: [],
      clashBridge: bridgeOff,
      port: 0,
    };
    await store.save(base);
    app = await createApp({
      store,
      port: 0,
      probeFetch: async () => {
        await new Promise((r) => setTimeout(r, 5));
        return new Response(null, { status: 204 });
      },
    });
    await listen(app);
    const addr = app.server.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");
    return addr.port;
  }

  it("POST /admin/api/proxy-pool/:id/test returns latency", async () => {
    const port = await boot([
      px({ id: "px1", name: "SG", type: "http", host: "10.0.0.9", port: 8080 }),
    ]);
    const res = await fetch(`http://127.0.0.1:${port}/admin/api/proxy-pool/px1/test`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      result: { ok: boolean; latencyMs: number | null; id: string };
      probeResults: Record<string, { latencyMs: number | null }>;
    };
    expect(data.result.id).toBe("px1");
    expect(data.result.ok).toBe(true);
    expect(data.result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(data.probeResults.px1.latencyMs).toBe(data.result.latencyMs);
  });

  it("POST /admin/api/proxy-pool/test-batch probes all", async () => {
    const port = await boot([
      px({ id: "a", name: "a", type: "http", host: "1.1.1.1", port: 80 }),
      px({
        id: "b",
        name: "b",
        type: "vless",
        host: "2.2.2.2",
        port: 443,
        usable: false,
        bridgeable: true,
      }),
    ]);
    const res = await fetch(`http://127.0.0.1:${port}/admin/api/proxy-pool/test-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      results: Array<{ id: string; ok: boolean; skipped?: boolean }>;
      summary: { total: number; ok: number; skip: number };
    };
    expect(data.summary.total).toBe(2);
    expect(data.summary.ok).toBe(1);
    expect(data.summary.skip).toBe(1);
    expect(data.results.find((r) => r.id === "b")?.skipped).toBe(true);
  });

  it("GET /admin/api/proxy-pool includes probeResults after test", async () => {
    const port = await boot([
      px({ id: "z", name: "z", type: "socks5", host: "127.0.0.1", port: 1080 }),
    ]);
    await fetch(`http://127.0.0.1:${port}/admin/api/proxy-pool/z/test`, { method: "POST" });
    const res = await fetch(`http://127.0.0.1:${port}/admin/api/proxy-pool`);
    const data = (await res.json()) as {
      probeResults: Record<string, { ok: boolean }>;
    };
    expect(data.probeResults.z.ok).toBe(true);
  });
});
