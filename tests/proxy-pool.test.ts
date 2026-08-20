/**
 * Proxy pool + Clash subscription parse + worker binding tests.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assignHealthyProxiesToWorkers,
  mergeSubscriptionProxies,
  resolveAccountEgress,
  normalizeProxyPool,
  newProxyId,
  type PoolProxy,
} from "../src/proxy/pool.js";
import { parseSubscriptionBody, fetchClashSubscription } from "../src/proxy/clash.js";
import { UpstreamClient } from "../src/proxy/upstream.js";
import { SettingsStore, type GatewaySettings } from "../src/settings/store.js";
import { createApp, close, listen, type App } from "../src/server/http.js";
import { ProbeResultCache } from "../src/proxy/probe.js";

function settings(over: Partial<GatewaySettings> = {}): GatewaySettings {
  return {
    baseUrl: "https://opencode.ai/zen/v1",
    synthesizeCliHeaders: false,
    cliUserAgent: "opencode-cli/1.0.0",
    cliClient: "cli",
    cliProject: "default",
    accounts: [{ id: "w1", apiKey: "k1", proxyId: null, proxy: null }],
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
    port: 9876,
    ...over,
  };
}

describe("parseSubscriptionBody", () => {
  it("parses Clash YAML http/socks5 proxies", () => {
    const yaml = `
proxies:
  - name: "HK-HTTP"
    type: http
    server: 1.1.1.1
    port: 8080
    username: u1
    password: p1
  - name: "JP-SOCKS"
    type: socks5
    server: 2.2.2.2
    port: 1080
  - name: "SS-skip"
    type: ss
    server: 3.3.3.3
    port: 8388
    cipher: aes-256-gcm
    password: x
`;
    const result = parseSubscriptionBody(yaml, "sub1");
    expect(result.format).toBe("clash-yaml");
    expect(result.usableCount).toBe(2);
    expect(result.proxies.some((p) => p.name === "HK-HTTP" && p.usable)).toBe(true);
    expect(result.proxies.some((p) => p.name === "JP-SOCKS" && p.type === "socks5")).toBe(
      true
    );
    const ss = result.proxies.find((p) => p.name === "SS-skip");
    expect(ss?.usable).toBe(false);
    expect(ss?.bridgeable).toBe(true);
  });

  it("parses base64 URI list", () => {
    const lines = [
      "http://user:pass@10.0.0.1:8888",
      "socks5://10.0.0.2:1080",
    ].join("\n");
    const b64 = Buffer.from(lines, "utf8").toString("base64");
    const result = parseSubscriptionBody(b64, "sub-uri");
    expect(result.usableCount).toBe(2);
    expect(result.proxies[0].host).toBe("10.0.0.1");
    expect(result.proxies[0].username).toBe("user");
    expect(result.proxies[1].type).toBe("socks5");
  });

  it("parses plain multi-line URI list", () => {
    const result = parseSubscriptionBody(
      "http://1.2.3.4:7890\nsocks5://5.6.7.8:1080\n",
      "s"
    );
    expect(result.format).toBe("uri-list");
    expect(result.usableCount).toBe(2);
  });

  it("parses mitce-style base64 vless/hysteria2 URI list (was empty before)", () => {
    const lines = [
      "vless://F2987FBA-B653-444D-8057-6B6474E448C6@hk1-r.example.com:10126?type=grpc&security=reality#HK-1",
      "hysteria2://secret@jp1-hy2.example.com:443?insecure=0#JP1-HY2",
      "tuic://uuid:pass@us1.example.com:8443?congestion_control=bbr#US-TUIC",
    ].join("\n");
    const b64 = Buffer.from(lines, "utf8").toString("base64");
    const result = parseSubscriptionBody(b64, "mitce");
    expect(result.format).toBe("uri-list");
    expect(result.proxies.length).toBe(3);
    expect(result.usableCount).toBe(0);
    expect(result.bridgeableCount).toBe(3);
    expect(result.proxies[0].name).toBe("HK-1");
    expect(result.proxies[0].host).toBe("hk1-r.example.com");
    expect(result.proxies[0].port).toBe(10126);
    expect(result.proxies[0].type).toBe("vless");
    expect(result.proxies[1].type).toBe("hysteria2");
    expect(result.proxies[2].type).toBe("tuic");
  });

  it("parses Clash YAML with vless nodes + hints", () => {
    const yaml = `
mixed-port: 7892
port: 7890
external-controller: '127.0.0.1:9090'
proxies:
  - name: HK-1
    type: vless
    server: hk1.example.com
    port: 10126
    uuid: abc
  - name: JP-1
    type: hysteria2
    server: jp1.example.com
    port: 443
    password: x
  - name: HK2-HY2
    type: hysteria2
    server: hk2.example.com
    ports: "20200-20399"
    password: x
proxy-groups:
  - name: 主代理
    type: select
    proxies: [HK-1, JP-1]
  - name: OpenAI
    type: select
    proxies: [HK-1]
`;
    const result = parseSubscriptionBody(yaml, "sub");
    expect(result.format).toBe("clash-yaml");
    expect(result.proxies.length).toBe(3);
    expect(result.bridgeableCount).toBe(3);
    expect(result.proxies.find((p) => p.name === "HK2-HY2")?.port).toBe(20200);
    expect(result.clashHints?.mixedPort).toBe(7892);
    expect(result.clashHints?.selectorGroups?.[0]).toBe("主代理");
  });
});

describe("resolveAccountEgress + merge", () => {
  it("binds worker to pool proxy by proxyId", () => {
    const pool: PoolProxy[] = [
      {
        id: "px_a",
        name: "a",
        type: "http",
        host: "9.9.9.9",
        port: 8000,
        enabled: true,
        source: "manual",
        usable: true,
      },
    ];
    const resolved = resolveAccountEgress({ proxyId: "px_a", proxy: null }, pool);
    expect(resolved.proxy).toEqual({
      type: "http",
      host: "9.9.9.9",
      port: 8000,
      username: undefined,
      password: undefined,
    });
  });

  it("falls back to legacy inline proxy when proxyId missing", () => {
    const resolved = resolveAccountEgress(
      { proxyId: null, proxy: { type: "http", host: "127.0.0.1", port: 7890 } },
      []
    );
    expect(resolved.proxy?.host).toBe("127.0.0.1");
  });

  it("resolves vless node via Clash bridge to local mixed-port", () => {
    const pool: PoolProxy[] = [
      {
        id: "px_v",
        name: "HK-1",
        type: "vless",
        host: "hk.example.com",
        port: 10126,
        enabled: true,
        source: "subscription",
        usable: false,
        bridgeable: true,
        clashNodeName: "HK-1",
      },
    ];
    const bridge = {
      enabled: true,
      apiBase: "http://127.0.0.1:9090",
      apiSecret: "",
      localProxyHost: "127.0.0.1",
      localProxyPort: 7892,
      selectorGroup: "主代理",
    };
    const egress = resolveAccountEgress({ proxyId: "px_v" }, pool, bridge);
    expect(egress.proxy).toEqual({
      type: "http",
      host: "127.0.0.1",
      port: 7892,
    });
    expect(egress.clashNodeName).toBe("HK-1");
  });

  it("mergeSubscriptionProxies replaces only same subscription entries", () => {
    const pool: PoolProxy[] = [
      {
        id: "m1",
        name: "manual",
        type: "http",
        host: "1.1.1.1",
        port: 1,
        enabled: true,
        source: "manual",
        usable: true,
      },
      {
        id: "s1",
        name: "old",
        type: "http",
        host: "2.2.2.2",
        port: 2,
        enabled: true,
        source: "subscription",
        subscriptionId: "subA",
        usable: true,
      },
    ];
    const imported: PoolProxy[] = [
      {
        id: "s2",
        name: "new",
        type: "socks5",
        host: "3.3.3.3",
        port: 3,
        enabled: true,
        source: "subscription",
        usable: true,
      },
    ];
    const merged = mergeSubscriptionProxies(pool, "subA", imported);
    expect(merged.find((p) => p.id === "m1")).toBeTruthy();
    expect(merged.find((p) => p.id === "s1")).toBeFalsy();
    expect(merged.find((p) => p.host === "3.3.3.3")?.subscriptionId).toBe("subA");
  });
});

describe("assignHealthyProxiesToWorkers", () => {
  function px(
    id: string,
    over: Partial<PoolProxy> = {}
  ): PoolProxy {
    return {
      id,
      name: id,
      type: "http",
      host: "10.0.0." + id.slice(-1),
      port: 8000,
      enabled: true,
      source: "manual",
      usable: true,
      ...over,
    };
  }

  it("assigns unique healthy proxies sorted by latency", () => {
    const result = assignHealthyProxiesToWorkers({
      accounts: [
        { id: "w1", apiKey: "k1", proxyId: null, proxy: null },
        { id: "w2", apiKey: "k2", proxyId: "old", proxy: null },
        { id: "w3", apiKey: "k3", proxyId: null, proxy: null },
      ],
      pool: [px("slow"), px("fast"), px("mid"), px("bad")],
      probeResults: {
        slow: { ok: true, health: "healthy", latencyMs: 300, anonymousZen: { ok: true } },
        fast: { ok: true, health: "healthy", latencyMs: 40, anonymousZen: { ok: true } },
        mid: { ok: true, health: "healthy", latencyMs: 120, anonymousZen: { ok: true } },
        bad: { ok: false, health: "bad", latencyMs: null },
      },
    });

    expect(result.healthyAvailable).toBe(3);
    expect(result.assigned).toBe(3);
    expect(result.unassigned).toBe(0);
    expect(result.accounts.map((a) => a.proxyId)).toEqual(["fast", "mid", "slow"]);
    expect(new Set(result.accounts.map((a) => a.proxyId)).size).toBe(3);
  });

  it("leaves surplus workers unbound when healthy proxies run out", () => {
    const result = assignHealthyProxiesToWorkers({
      accounts: [
        { id: "w1", apiKey: "", proxyId: "keep-me", proxy: null },
        { id: "w2", apiKey: "", proxyId: null, proxy: null },
      ],
      pool: [px("only")],
      probeResults: {
        only: { ok: true, health: "healthy", latencyMs: 10, anonymousZen: { ok: true } },
      },
    });
    expect(result.assigned).toBe(1);
    expect(result.unassigned).toBe(1);
    expect(result.accounts[0].proxyId).toBe("only");
    expect(result.accounts[1].proxyId).toBeNull();
  });

  it("preserves disabled state while assigning proxies", () => {
    const result = assignHealthyProxiesToWorkers({
      accounts: [{ id: "paused", apiKey: "", enabled: false, proxyId: null, proxy: null }],
      pool: [px("only")],
      probeResults: {
        only: { ok: true, health: "healthy", latencyMs: 10, anonymousZen: { ok: true } },
      },
    });
    expect(result.accounts[0]).toMatchObject({ id: "paused", enabled: false, proxyId: "only" });
  });

  it("does not assign two nodes with the same measured egress IP", () => {
    const result = assignHealthyProxiesToWorkers({
      accounts: [
        { id: "w1", apiKey: "", proxyId: null, proxy: null },
        { id: "w2", apiKey: "", proxyId: null, proxy: null },
      ],
      pool: [px("a"), px("b")],
      probeResults: {
        a: { ok: true, health: "healthy", latencyMs: 10, egressIp: "203.0.113.7", anonymousZen: { ok: true } },
        b: { ok: true, health: "healthy", latencyMs: 20, egressIp: "203.0.113.7", anonymousZen: { ok: true } },
      },
    });
    expect(result.healthyAvailable).toBe(1);
    expect(result.assigned).toBe(1);
  });

  it("allows one anonymous and one authenticated worker to share a verified egress", () => {
    const result = assignHealthyProxiesToWorkers({
      accounts: [
        { id: "anonymous", kind: "anonymous_zen", apiKey: "", proxyId: null },
        { id: "login", kind: "authenticated_zen", apiKey: "zen-key", proxyId: null },
      ],
      pool: [px("shared")],
      probeResults: {
        shared: {
          ok: true,
          health: "healthy",
          latencyMs: 10,
          egressIp: "203.0.113.8",
          anonymousZen: { ok: true },
        },
      },
    });
    expect(result.assigned).toBe(2);
    expect(result.accounts.map((account) => account.proxyId)).toEqual(["shared", "shared"]);
    expect(result.accounts.map((account) => account.kind)).toEqual([
      "anonymous_zen",
      "authenticated_zen",
    ]);
  });

  it("does not assign a network-healthy proxy until anonymous Zen succeeds", () => {
    const result = assignHealthyProxiesToWorkers({
      accounts: [{ id: "anonymous", apiKey: "", proxyId: null }],
      pool: [px("network-only")],
      probeResults: {
        "network-only": { ok: true, health: "healthy", latencyMs: 10 },
      },
    });
    expect(result.healthyAvailable).toBe(0);
    expect(result.assigned).toBe(0);
  });

  it("ignores structural-usable nodes that never probed healthy", () => {
    const result = assignHealthyProxiesToWorkers({
      accounts: [{ id: "w1", apiKey: "", proxyId: null, proxy: null }],
      pool: [px("untested")],
      probeResults: {},
    });
    expect(result.healthyAvailable).toBe(0);
    expect(result.assigned).toBe(0);
    expect(result.accounts[0].proxyId).toBeNull();
  });

  it("skips bridge-only healthy nodes when Clash bridge is off", () => {
    const result = assignHealthyProxiesToWorkers({
      accounts: [{ id: "w1", apiKey: "", proxyId: null, proxy: null }],
      pool: [
        px("vless", {
          type: "vless",
          usable: false,
          bridgeable: true,
          clashNodeName: "vless",
        }),
      ],
      probeResults: {
        vless: { ok: true, health: "healthy", latencyMs: 50 },
      },
      bridge: {
        enabled: false,
        apiBase: "http://127.0.0.1:9090",
        apiSecret: "",
        localProxyHost: "127.0.0.1",
        localProxyPort: 7890,
        selectorGroup: "GLOBAL",
      },
    });
    expect(result.healthyAvailable).toBe(0);
    expect(result.assigned).toBe(0);
  });
});

describe("UpstreamClient uses bound pool proxy", () => {
  it("passes dispatcher when worker has proxyId in pool", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit & { dispatcher?: unknown }) => {
      expect(init?.dispatcher).toBeTruthy();
      return new Response(
        JSON.stringify({
          id: "1",
          object: "chat.completion",
          choices: [{ message: { role: "assistant", content: "ok" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const client = new UpstreamClient(
      settings({
        proxyPool: [
          {
            id: "px1",
            name: "egress-1",
            type: "http",
            host: "10.0.0.9",
            port: 8888,
            enabled: true,
            source: "manual",
            usable: true,
          },
        ],
        accounts: [{ id: "w1", apiKey: "key", proxyId: "px1", proxy: null }],
      }),
      fetchImpl
    );

    const result = await client.chatCompletions({
      body: { model: "big-pickle", messages: [{ role: "user", content: "x" }] },
      stream: false,
    });
    expect(result.status).toBe(200);
    expect(result.proxyId).toBe("px1");
    expect(fetchImpl).toHaveBeenCalled();
  });
});

describe("admin proxy-pool HTTP APIs", () => {
  let app: App | null = null;
  let dir = "";

  afterEach(async () => {
    if (app) {
      await close(app);
      app = null;
    }
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = "";
    }
  });

  it("adds manual proxy, binds worker, fetches clash subscription into pool", async () => {
    dir = await mkdtemp(join(tmpdir(), "ocfr-pool-"));
    const store = new SettingsStore(join(dir, "settings.json"));
    await store.save(settings());

    const clashBody = `
proxies:
  - { name: "sub-node", type: http, server: 8.8.8.8, port: 3128 }
`;
    const subFetch = vi.fn(async () => new Response(clashBody, { status: 200 }));

    app = await createApp({
      store,
      port: 0,
      fetchImpl: async () => new Response("{}", { status: 200 }),
      subscriptionFetch: subFetch as unknown as typeof fetch,
    });
    await listen(app);
    const addr = app.server.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");
    const base = `http://127.0.0.1:${addr.port}`;

    // manual add
    const addRes = await fetch(`${base}/admin/api/proxy-pool`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "manual-1",
        type: "http",
        host: "127.0.0.1",
        port: 7890,
      }),
    });
    expect(addRes.status).toBe(200);
    let s = (await addRes.json()) as GatewaySettings;
    expect(s.proxyPool.length).toBe(1);
    const manualId = s.proxyPool[0].id;

    // bind worker
    const put = await fetch(`${base}/admin/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...s,
        accounts: [{ id: "worker-a", apiKey: "ak", proxyId: manualId, proxy: null }],
      }),
    });
    expect(put.status).toBe(200);
    s = (await put.json()) as GatewaySettings;
    expect(s.accounts[0].proxyId).toBe(manualId);

    // add subscription + fetch
    const subRes = await fetch(`${base}/admin/api/proxy-subscriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test-sub", url: "https://example.com/clash" }),
    });
    expect(subRes.status).toBe(200);
    const subBody = (await subRes.json()) as {
      subscription: { id: string };
      settings: GatewaySettings;
    };
    const subId = subBody.subscription.id;

    const fetchRes = await fetch(
      `${base}/admin/api/proxy-subscriptions/${encodeURIComponent(subId)}/fetch`,
      { method: "POST" }
    );
    expect(fetchRes.status).toBe(200);
    const fetched = (await fetchRes.json()) as {
      usableCount: number;
      settings: GatewaySettings;
    };
    expect(fetched.usableCount).toBe(1);
    expect((fetched as { totalCount?: number }).totalCount).toBe(1);
    expect(fetched.settings.proxyPool.some((p) => p.host === "8.8.8.8")).toBe(true);
    expect(fetched.settings.proxyPool.some((p) => p.host === "127.0.0.1")).toBe(true);
    expect(subFetch).toHaveBeenCalled();

    // status reflects pool
    const st = (await (await fetch(`${base}/admin/api/status`)).json()) as {
      proxyPoolCount: number;
      proxyPoolUsable: number;
    };
    expect(st.proxyPoolCount).toBeGreaterThanOrEqual(2);
    expect(st.proxyPoolUsable).toBeGreaterThanOrEqual(2);

    // admin page mentions proxy pool
    const html = await (await fetch(`${base}/`)).text();
    expect(html).toMatch(/Proxy [Pp]ool/);
    expect(html).toContain("Clash");
    expect(html).toContain("btn-assign-proxies");
    expect(html).toContain("/admin/api/workers/assign-proxies");
  });

  it("tests exactly one bound worker with a real proxied chat request", async () => {
    dir = await mkdtemp(join(tmpdir(), "ocfr-worker-test-"));
    const store = new SettingsStore(join(dir, "settings.json"));
    await store.save(
      settings({
        accounts: [
          { id: "target", apiKey: "target-key", proxyId: "px", proxy: null },
          { id: "other", apiKey: "other-key", proxyId: null, proxy: null },
        ],
        proxyPool: [
          {
            id: "px",
            name: "Mexico",
            type: "http",
            host: "127.0.0.1",
            port: 17891,
            enabled: true,
            source: "manual",
            usable: true,
            bridgeable: true,
          },
        ],
      })
    );
    const upstreamFetch = vi.fn(async (_url: string, init?: RequestInit & { dispatcher?: unknown }) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer target-key");
      expect(init?.dispatcher).toBeTruthy();
      return new Response(
        JSON.stringify({
          id: "test",
          object: "chat.completion",
          choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    app = await createApp({
      store,
      port: 0,
      fetchImpl: upstreamFetch,
      probeFetch: async () => new Response("203.0.113.25", { status: 200 }),
    });
    await listen(app);
    const addr = app.server.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");
    const base = `http://127.0.0.1:${addr.port}`;

    const res = await fetch(`${base}/admin/api/workers/target/test`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      workerId: string;
      upstreamStatus: number;
      egressIp: string;
      proxyName: string;
    };
    expect(body).toMatchObject({
      ok: true,
      workerId: "target",
      upstreamStatus: 200,
      egressIp: "203.0.113.25",
      proxyName: "Mexico",
    });
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    expect(app.probes.get("px")?.anonymousZen).toBeNull();

    const unbound = await fetch(`${base}/admin/api/workers/other/test`, { method: "POST" });
    expect(unbound.status).toBe(400);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);

    const html = await (await fetch(`${base}/`)).text();
    expect(html).toContain("btn-test-worker");
    expect(html).toContain("/admin/api/workers/");
  });

  it("returns 400 when no probe-healthy proxies exist", async () => {
    dir = await mkdtemp(join(tmpdir(), "ocfr-assign-empty-"));
    const store = new SettingsStore(join(dir, "settings.json"));
    await store.save(
      settings({
        accounts: [{ id: "w1", apiKey: "a", proxyId: null, proxy: null }],
        proxyPool: [
          {
            id: "px1",
            name: "n1",
            type: "http",
            host: "1.1.1.1",
            port: 8080,
            enabled: true,
            source: "manual",
            usable: true,
          },
        ],
      })
    );
    app = await createApp({
      store,
      port: 0,
      probes: new ProbeResultCache(),
      fetchImpl: async () => new Response("{}", { status: 200 }),
    });
    await listen(app);
    const addr = app.server.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");
    const res = await fetch(
      `http://127.0.0.1:${addr.port}/admin/api/workers/assign-proxies`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
    );
    expect(res.status).toBe(400);
  });

  it("auto-assigns unique healthy proxies to each worker", async () => {
    dir = await mkdtemp(join(tmpdir(), "ocfr-assign-"));
    const store = new SettingsStore(join(dir, "settings.json"));
    await store.save(
      settings({
        accounts: [
          { id: "w1", apiKey: "a", proxyId: null, proxy: null },
          { id: "w2", apiKey: "b", proxyId: null, proxy: null },
          { id: "w3", apiKey: "c", proxyId: null, proxy: null },
        ],
        proxyPool: [
          {
            id: "px-fast",
            name: "fast",
            type: "http",
            host: "1.1.1.1",
            port: 8080,
            enabled: true,
            source: "manual",
            usable: true,
          },
          {
            id: "px-slow",
            name: "slow",
            type: "http",
            host: "2.2.2.2",
            port: 8080,
            enabled: true,
            source: "manual",
            usable: true,
          },
          {
            id: "px-dead",
            name: "dead",
            type: "http",
            host: "3.3.3.3",
            port: 8080,
            enabled: true,
            source: "manual",
            usable: true,
          },
        ],
      })
    );

    const probes = new ProbeResultCache();
    probes.setMany([
      {
        id: "px-fast",
        ok: true,
        latencyMs: 30,
        error: null,
        testedAt: new Date().toISOString(),
        health: "healthy",
        anonymousZen: { id: "px-fast", status: "usable", ok: true, httpStatus: 200, latencyMs: 50, error: null, testedAt: new Date().toISOString() },
      },
      {
        id: "px-slow",
        ok: true,
        latencyMs: 200,
        error: null,
        testedAt: new Date().toISOString(),
        health: "healthy",
        anonymousZen: { id: "px-slow", status: "usable", ok: true, httpStatus: 200, latencyMs: 50, error: null, testedAt: new Date().toISOString() },
      },
      {
        id: "px-dead",
        ok: false,
        latencyMs: null,
        error: "Timeout",
        testedAt: new Date().toISOString(),
        health: "bad",
      },
    ]);

    app = await createApp({
      store,
      port: 0,
      probes,
      fetchImpl: async () => new Response("{}", { status: 200 }),
    });
    await listen(app);
    const addr = app.server.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");
    const base = `http://127.0.0.1:${addr.port}`;

    const res = await fetch(`${base}/admin/api/workers/assign-proxies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      assigned: number;
      unassigned: number;
      healthyAvailable: number;
      settings: GatewaySettings;
    };
    expect(body.healthyAvailable).toBe(2);
    expect(body.assigned).toBe(2);
    expect(body.unassigned).toBe(1);
    expect(body.settings.accounts[0].proxyId).toBe("px-fast");
    expect(body.settings.accounts[1].proxyId).toBe("px-slow");
    expect(body.settings.accounts[2].proxyId).toBeNull();

    const saved = (await (await fetch(`${base}/admin/api/settings`)).json()) as GatewaySettings;
    expect(saved.accounts.map((a) => a.proxyId)).toEqual(["px-fast", "px-slow", null]);
  });
});
