/**
 * Proxy latency probe unit + HTTP API tests.
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  probeAnonymousZenProxy,
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

  it("runs eight independent direct probes concurrently by default", async () => {
    let active = 0;
    let maxActive = 0;
    const list = Array.from({ length: 8 }, (_, index) =>
      px({
        id: `direct-${index}`,
        name: `direct-${index}`,
        type: "http",
        host: `10.0.0.${index + 1}`,
        port: 8080,
      })
    );

    const results = await probePoolProxies(list, bridgeOff, {
      fetchImpl: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active--;
        return new Response("203.0.113.1", { status: 200 });
      },
    });

    expect(results.every((result) => result.ok)).toBe(true);
    expect(maxActive).toBe(8);
  });

  it("reports each final batch result as it completes", async () => {
    const reported: Array<{ id: string; completed: number; total: number }> = [];
    const list = [
      px({ id: "fast", name: "fast", type: "http", host: "10.0.0.1", port: 8080 }),
      px({ id: "slow", name: "slow", type: "http", host: "10.0.0.2", port: 8080 }),
    ];

    const results = await probePoolProxies(list, bridgeOff, {
      fetchImpl: async () => new Response("203.0.113.1", { status: 200 }),
      onResult: (result, completed, total) => {
        reported.push({ id: result.id, completed, total });
      },
    });

    expect(results).toHaveLength(2);
    expect(reported).toHaveLength(2);
    expect(reported.map((item) => item.id).sort()).toEqual(["fast", "slow"]);
    expect(reported.map((item) => item.completed).sort()).toEqual([1, 2]);
    expect(reported.every((item) => item.total === 2)).toBe(true);
  });

  it("reports Controller screening and final verification incrementally", async () => {
    const list = ["Mexico", "Japan"].map((name, index) =>
      px({
        id: `controller-progress-${index}`,
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
    let selected = "";
    let releaseSecond!: () => void;
    const secondBlocked = new Promise<void>((resolve) => { releaseSecond = resolve; });
    const stages: Array<{ stage: string; completed: number }> = [];
    const reported: string[] = [];
    const run = probePoolProxies(list, { ...bridgeOn, selectorGroup: "Proxy" }, {
      fastController: true,
      verifyEgressCount: list.length,
      bridgeFetch: (async (url: string, init?: RequestInit) => {
        if (init?.method === "PUT") {
          selected = (JSON.parse(String(init.body)) as { name: string }).name;
          return new Response(null, { status: 204 });
        }
        return new Response(JSON.stringify({ delay: 10 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch,
      fetchImpl: async () => {
        if (selected === "Japan") await secondBlocked;
        return new Response(selected === "Mexico" ? "203.0.113.50" : "203.0.113.51");
      },
      onStageProgress: (stage, completed) => {
        stages.push({ stage, completed });
      },
      onResult: (result) => {
        reported.push(result.id);
      },
    });

    for (let attempt = 0; attempt < 20 && reported.length === 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(stages.some((item) => item.stage === "screening" && item.completed === 1)).toBe(true);
    expect(reported).toEqual(["controller-progress-0"]);
    releaseSecond();
    await run;
    expect(reported).toEqual(["controller-progress-0", "controller-progress-1"]);
  });

  it("reuses one Clash selection for egress and anonymous Zen checks", async () => {
    let selected = "";
    const switches: string[] = [];
    let anonymousRequests = 0;
    const list = ["Mexico", "Japan"].map((name, index) =>
      px({
        id: `controller-${index}`,
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
    const bridge = { ...bridgeOn, selectorGroup: "Proxy" };
    const bridgeFetch = (async (url: string, init?: RequestInit) => {
      if ((init?.method || "GET") === "PUT") {
        selected = String((JSON.parse(String(init?.body)) as { name: string }).name);
        switches.push(selected);
        return new Response(null, { status: 204 });
      }
      if (String(url).includes("/delay?")) {
        return new Response(JSON.stringify({ delay: 20 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;
    const anonymousByIp = new Map<string, ReturnType<typeof probeAnonymousZenProxy>>();

    const results = await probePoolProxies(list, bridge, {
      fastController: true,
      verifyEgressCount: list.length,
      bridgeFetch,
      fetchImpl: async (_url, init) => {
        if (init.method === "POST") {
          anonymousRequests++;
          return new Response(JSON.stringify({ choices: [] }), { status: 200 });
        }
        return new Response(selected === "Mexico" ? "203.0.113.10" : "203.0.113.11", {
          status: 200,
        });
      },
      afterProbe: async (proxy, result) => {
        const ip = result.egressIp!;
        let anonymous = anonymousByIp.get(ip);
        if (!anonymous) {
          anonymous = probeAnonymousZenProxy(proxy, bridge, {
            bridgeFetch,
            fetchImpl: async (_url, init) => {
              if (init.method === "POST") anonymousRequests++;
              return new Response(JSON.stringify({ choices: [] }), { status: 200 });
            },
            skipClashSwitch: true,
          });
          anonymousByIp.set(ip, anonymous);
        }
        return { ...result, anonymousZen: await anonymous };
      },
    });

    expect(results.every((result) => result.anonymousZen?.ok)).toBe(true);
    expect(switches).toEqual(["Mexico", "Japan"]);
    expect(anonymousRequests).toBe(2);
  });
});

describe("probeAnonymousZenProxy", () => {
  it("sends a real anonymous Zen request through the selected proxy", async () => {
    let requestUrl = "";
    let requestInit: (RequestInit & { dispatcher?: unknown }) | undefined;
    const result = await probeAnonymousZenProxy(
      px({ id: "anon", name: "anon", type: "http", host: "10.0.0.4", port: 8080 }),
      bridgeOff,
      {
        baseUrl: "https://opencode.ai/zen/v1/",
        model: "deepseek-v4-flash-free",
        fetchImpl: async (url, init) => {
          requestUrl = url;
          requestInit = init;
          return new Response(JSON.stringify({ choices: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      }
    );

    expect(result.status).toBe("usable");
    expect(result.ok).toBe(true);
    expect(result.httpStatus).toBe(200);
    expect(result.error).toBeNull();
    expect(requestUrl).toBe("https://opencode.ai/zen/v1/chat/completions");
    expect(new Headers(requestInit?.headers).get("authorization")).toBe("Bearer public");
    expect(new Headers(requestInit?.headers).get("user-agent")).toBe("opencode-cli/1.0.0");
    expect(new Headers(requestInit?.headers).get("x-opencode-client")).toBe("cli");
    expect(new Headers(requestInit?.headers).get("x-opencode-session")).toBeTruthy();
    expect(requestInit?.dispatcher).toBeTruthy();
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({
      model: "deepseek-v4-flash-free",
      messages: [{ role: "user", content: "x" }],
      stream: false,
      max_tokens: 1,
    });
  });

  it.each([
    [401, "blocked"],
    [403, "blocked"],
    [429, "rate_limited"],
    [500, "temporary_failure"],
    [400, "temporary_failure"],
    [407, "unreachable"],
  ] as const)("maps HTTP %i to %s", async (httpStatus, status) => {
    const result = await probeAnonymousZenProxy(
      px({ id: `s${httpStatus}`, name: "status", type: "http", host: "10.0.0.5", port: 8080 }),
      bridgeOff,
      {
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: { message: "upstream rejected" } }), {
            status: httpStatus,
            headers: httpStatus === 429 ? { "Retry-After": "120" } : undefined,
          }),
      }
    );

    expect(result.status).toBe(status);
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(httpStatus);
    expect(result.error).toBe("upstream rejected");
    if (httpStatus === 429) expect(result.retryAfterSeconds).toBe(120);
  });

  it("aborts a slow anonymous request at the configured timeout", async () => {
    const result = await probeAnonymousZenProxy(
      px({ id: "slow-anon", name: "slow", type: "http", host: "10.0.0.6", port: 8080 }),
      bridgeOff,
      {
        timeoutMs: 20,
        fetchImpl: async (_url, init) => {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 500);
            init.signal?.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(new DOMException("aborted", "AbortError"));
            });
          });
          return new Response(null, { status: 200 });
        },
      }
    );

    expect(result.status).toBe("unreachable");
    expect(result.httpStatus).toBeNull();
    expect(result.error).toBe("Timeout");
    expect(result.latencyMs).toBeGreaterThanOrEqual(10);
  });

  it("switches a Clash node before sending the anonymous request", async () => {
    const calls: string[] = [];
    const result = await probeAnonymousZenProxy(
      px({
        id: "anon-clash",
        name: "Mexico",
        type: "hysteria2",
        host: "192.0.2.8",
        port: 443,
        usable: false,
        bridgeable: true,
        clashNodeName: "Mexico",
      }),
      { ...bridgeOn, selectorGroup: "Proxy" },
      {
        bridgeFetch: (async (_url: string, init?: RequestInit) => {
          calls.push(`switch:${String(init?.body)}`);
          return new Response(null, { status: 204 });
        }) as typeof fetch,
        fetchImpl: async () => {
          calls.push("zen");
          return new Response("{}", { status: 200 });
        },
      }
    );

    expect(result.status).toBe("usable");
    expect(calls[0]).toContain('"Mexico"');
    expect(calls[1]).toBe("zen");
  });

  it("does not probe a bridge node when the Clash bridge is disabled", async () => {
    let called = false;
    const result = await probeAnonymousZenProxy(
      px({
        id: "no-bridge",
        name: "no-bridge",
        type: "vless",
        host: "192.0.2.9",
        port: 443,
        usable: false,
        bridgeable: true,
      }),
      bridgeOff,
      {
        fetchImpl: async () => {
          called = true;
          return new Response("{}", { status: 200 });
        },
      }
    );

    expect(result.status).toBe("unreachable");
    expect(result.error).toBe("Clash bridge required");
    expect(result.latencyMs).toBeNull();
    expect(called).toBe(false);
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

  async function boot(
    pool: PoolProxy[],
    probeFetch: (
      url: string,
      init: RequestInit & { dispatcher?: unknown }
    ) => Promise<Response> = async () => {
      await new Promise((r) => setTimeout(r, 5));
      return new Response(null, { status: 204 });
    }
  ) {
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
      probeFetch,
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

  it("publishes incremental batch progress and rejects overlapping batches", async () => {
    dir = await mkdtemp(join(tmpdir(), "ocfr-probe-progress-"));
    const store = new SettingsStore(join(dir, "settings.json"));
    await store.save({
      baseUrl: "https://opencode.ai/zen/v1",
      accounts: [],
      proxyPool: [
        px({ id: "fast", name: "fast", type: "http", host: "10.0.0.1", port: 8080 }),
        px({ id: "blocked", name: "blocked", type: "http", host: "10.0.0.2", port: 8080 }),
      ],
    });
    let releaseBlocked!: () => void;
    const blocked = new Promise<void>((resolve) => { releaseBlocked = resolve; });
    let getCount = 0;
    app = await createApp({
      store,
      port: 0,
      probeFetch: async (_url, init) => {
        if (init.method === "GET" && ++getCount === 2) await blocked;
        return init.method === "POST"
          ? new Response(JSON.stringify({ choices: [] }), { status: 200 })
          : new Response(`203.0.113.${getCount}`, { status: 200 });
      },
    });
    await listen(app);
    const addr = app.server.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");
    const base = `http://127.0.0.1:${addr.port}/admin/api/proxy-pool/test-batch`;
    const batch = fetch(base, { method: "POST", body: "{}" });

    let progress: { running: boolean; total: number; completed: number; completedIds: string[] } | null = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      progress = await (await fetch(`${base}/status`)).json() as typeof progress;
      if (progress?.completed === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(progress).toMatchObject({ running: true, total: 2, completed: 1 });
    expect(progress?.completedIds).toEqual(["fast"]);

    const incrementalSettings = await (
      await fetch(`http://127.0.0.1:${addr.port}/admin/api/settings`)
    ).json() as { accounts: Array<{ id: string; kind: string; proxyId: string | null }> };
    expect(incrementalSettings.accounts).toContainEqual(expect.objectContaining({
      id: "anonymous-zen-fast",
      kind: "anonymous_zen",
      proxyId: "fast",
    }));

    const poolState = await (await fetch(`http://127.0.0.1:${addr.port}/admin/api/proxy-pool`)).json() as {
      probeResults: Record<string, unknown>;
      batchProbe: { running: boolean; completed: number; addedWorkerIds: string[] };
    };
    expect(poolState.probeResults.fast).toBeTruthy();
    expect(poolState.batchProbe).toMatchObject({
      running: true,
      completed: 1,
      addedWorkerIds: ["anonymous-zen-fast"],
    });

    const conflictingSave = await fetch(`http://127.0.0.1:${addr.port}/admin/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accounts: [] }),
    });
    expect(conflictingSave.status).toBe(409);
    expect(await conflictingSave.json()).toMatchObject({
      error: { type: "batch_probe_running" },
    });

    const overlap = await fetch(base, { method: "POST", body: "{}" });
    expect(overlap.status).toBe(409);
    releaseBlocked();
    expect((await batch).status).toBe(200);
    const finished = await (await fetch(`${base}/status`)).json() as {
      running: boolean; completed: number; finishedAt: string | null;
    };
    expect(finished).toMatchObject({ running: false, completed: 2 });
    expect(finished.finishedAt).toBeTruthy();
  });

  it("reserves a batch before reading its body and releases invalid requests", async () => {
    dir = await mkdtemp(join(tmpdir(), "ocfr-probe-lock-"));
    const store = new SettingsStore(join(dir, "settings.json"));
    await store.save({
      baseUrl: "https://opencode.ai/zen/v1",
      accounts: [],
      proxyPool: [
        px({ id: "only", name: "only", type: "http", host: "10.0.0.1", port: 8080 }),
      ],
    });
    app = await createApp({
      store,
      port: 0,
      probeFetch: async (_url, init) => init.method === "POST"
        ? new Response(JSON.stringify({ choices: [] }), { status: 200 })
        : new Response("203.0.113.40", { status: 200 }),
    });
    await listen(app);
    const addr = app.server.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");
    const url = `http://127.0.0.1:${addr.port}/admin/api/proxy-pool/test-batch`;
    const encoder = new TextEncoder();
    let bodyController!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        bodyController = controller;
        controller.enqueue(encoder.encode("{"));
      },
    });
    const first = fetch(url, {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    let running = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const status = await (await fetch(`${url}/status`)).json() as { running: boolean };
      running = status.running;
      if (running) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(running).toBe(true);
    expect((await fetch(url, { method: "POST", body: "{}" })).status).toBe(409);

    bodyController.enqueue(encoder.encode("}"));
    bodyController.close();
    expect((await first).status).toBe(200);
    expect((await fetch(url, { method: "POST", body: "{" })).status).toBe(400);
    const released = await (await fetch(`${url}/status`)).json() as { running: boolean; error: string | null };
    expect(released).toMatchObject({ running: false, error: "Invalid JSON" });
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
