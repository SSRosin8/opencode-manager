import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getClashSelectorCurrent,
  importClashControllerNodes,
  selectClashProxy,
} from "../src/proxy/clashBridge.js";
import { createApp, close, listen, type App } from "../src/server/http.js";
import { SettingsStore, type GatewaySettings } from "../src/settings/store.js";

function settings(overrides: Partial<GatewaySettings> = {}): GatewaySettings {
  return {
    baseUrl: "https://opencode.ai/zen/v1",
    relayAccessToken: "",
    synthesizeCliHeaders: false,
    cliUserAgent: "opencode-cli/1.0.0",
    cliClient: "cli",
    cliProject: "default",
    accounts: [{ id: "w1", apiKey: "k1", proxyId: null, proxy: null }],
    routingStrategy: "anonymous_first",
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
    ...overrides,
  };
}

function hangingControllerFetch(onSignal?: (signal: AbortSignal) => void): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const signal = init?.signal;
    if (!signal) throw new Error("missing abort signal");
    onSignal?.(signal);
    return await new Promise<Response>((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true }
      );
    });
  }) as typeof fetch;
}

describe("Clash Controller import", () => {
  it("bounds selector reads and switches with an abort timeout", async () => {
    const bridge = {
      ...settings().clashBridge,
      enabled: true,
      selectorGroup: "Proxy",
    };
    let readSignal: AbortSignal | undefined;
    await expect(
      getClashSelectorCurrent(bridge, hangingControllerFetch((signal) => {
        readSignal = signal;
      }), 20)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(readSignal?.aborted).toBe(true);

    let switchSignal: AbortSignal | undefined;
    await expect(
      selectClashProxy(bridge, "Mexico", hangingControllerFetch((signal) => {
        switchSignal = signal;
      }), 20)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(switchSignal?.aborted).toBe(true);
  });

  it("imports only leaf nodes with stable ids and exact names", async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(url), auth: headers.get("authorization") });
      return new Response(
        JSON.stringify({
          proxies: {
            Proxy: {
              type: "Selector",
              now: "Mexico",
              all: ["Mexico", "Spain  ", "Auto", "Fallback", "DIRECT", "Blocked"],
            },
            Mexico: { type: "AnyTLS" },
            "Spain  ": { type: "AnyTLS" },
            Auto: { type: "URLTest" },
            Fallback: { type: "Fallback" },
            DIRECT: { type: "Direct" },
            Blocked: { type: "Reject" },
            GLOBAL: { type: "Selector", all: ["Proxy", "DIRECT"] },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };
    const bridge = {
      enabled: true,
      apiBase: "http://127.0.0.1:9090",
      apiSecret: "secret",
      localProxyHost: "127.0.0.1",
      localProxyPort: 17891,
      selectorGroup: "Proxy",
    };

    const first = await importClashControllerNodes(bridge, fetchImpl as typeof fetch);
    const second = await importClashControllerNodes(bridge, fetchImpl as typeof fetch);
    const global = await importClashControllerNodes(
      { ...bridge, selectorGroup: "GLOBAL" },
      (async () =>
        new Response(
          JSON.stringify({
            proxies: {
              GLOBAL: { type: "Selector", now: "Mexico", all: ["Mexico", "Spain  "] },
              Mexico: { type: "AnyTLS" },
              "Spain  ": { type: "AnyTLS" },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )) as typeof fetch
    );

    expect(first.proxies.map((proxy) => proxy.name)).toEqual(["Mexico", "Spain  "]);
    expect(first.proxies.map((proxy) => proxy.clashNodeName)).toEqual(["Mexico", "Spain  "]);
    expect(first.proxies.every((proxy) => proxy.type === "anytls")).toBe(true);
    expect(first.proxies.every((proxy) => !proxy.usable && proxy.bridgeable)).toBe(true);
    expect(first.proxies.map((proxy) => proxy.id)).toEqual(
      second.proxies.map((proxy) => proxy.id)
    );
    expect(global.proxies.map((proxy) => proxy.id)).toEqual(
      first.proxies.map((proxy) => proxy.id)
    );
    expect(calls.every((call) => call.auth === "Bearer secret")).toBe(true);
  });
});

describe("Controller import API binding migration", () => {
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

  it("preserves worker bindings and probe results across selector changes", async () => {
    dir = await mkdtemp(join(tmpdir(), "opencode-manager-controller-"));
    const store = new SettingsStore(join(dir, "settings.json"));
    await store.save(settings({
      accounts: [
        { id: "w1", apiKey: "a", proxyId: null, proxy: null },
        { id: "w2", apiKey: "b", proxyId: null, proxy: null },
      ],
    }));
    const controllerFetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/proxies")) {
        return new Response(
          JSON.stringify({
            proxies: {
              Proxy: { type: "Selector", now: "Mexico", all: ["Mexico", "Spain", "Auto"] },
              GLOBAL: { type: "Selector", now: "Mexico", all: ["Mexico", "Spain"] },
              Mexico: { type: "AnyTLS" },
              Spain: { type: "AnyTLS" },
              Auto: { type: "URLTest", all: ["Mexico", "Spain"] },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(null, { status: 404 });
    });
    app = await createApp({
      store,
      port: 0,
      fetchImpl: async () => new Response("{}", { status: 200 }),
      subscriptionFetch: controllerFetch as unknown as typeof fetch,
    });
    await listen(app);
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("no address");
    const base = `http://127.0.0.1:${address.port}`;
    const bridge = {
      enabled: true,
      apiBase: "http://127.0.0.1:9090",
      apiSecret: "",
      localProxyHost: "127.0.0.1",
      localProxyPort: 17891,
      selectorGroup: "Proxy",
    };

    const firstResponse = await fetch(`${base}/admin/api/clash-bridge/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bridge),
    });
    expect(firstResponse.status).toBe(200);
    const first = (await firstResponse.json()) as {
      imported: number;
      settings: GatewaySettings;
    };
    expect(first.imported).toBe(2);
    expect(first.settings.clashBridge).toEqual(bridge);
    expect(first.settings.proxyPool.every((proxy) => proxy.source === "controller")).toBe(true);
    const ids = first.settings.proxyPool.map((proxy) => proxy.id);
    const legacyIds = ["legacy-proxy-mexico", "legacy-proxy-spain"];
    const legacyPool = first.settings.proxyPool.map((proxy, index) => ({
      ...proxy,
      id: legacyIds[index],
      controllerGroup: "Proxy",
    }));

    const bound = await store.save({
      proxyPool: legacyPool,
      accounts: [
        { id: "w1", apiKey: "a", proxyId: legacyIds[0], proxy: null },
        { id: "w2", apiKey: "b", proxyId: legacyIds[1], proxy: null },
      ],
    });
    app.upstream.updateSettings(bound);
    app.probes.set({
      id: legacyIds[0],
      ok: true,
      latencyMs: 10,
      error: null,
      testedAt: "2026-08-20T00:00:00.000Z",
      health: "healthy",
      egressIp: "203.0.113.10",
    });

    const secondResponse = await fetch(`${base}/admin/api/clash-bridge/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...bridge, selectorGroup: "GLOBAL" }),
    });
    const second = (await secondResponse.json()) as { settings: GatewaySettings };
    expect(secondResponse.status).toBe(200);
    expect(second.settings.proxyPool.map((proxy) => proxy.id)).toEqual(ids);
    expect(second.settings.accounts.map((account) => account.proxyId)).toEqual(ids);
    expect(
      second.settings.proxyPool.every((proxy) => proxy.controllerGroup === "GLOBAL")
    ).toBe(true);
    expect(app.probes.get(ids[0])).toMatchObject({
      id: ids[0],
      egressIp: "203.0.113.10",
    });
    expect(app.probes.get(legacyIds[0])).toBeUndefined();

    const changedController = "http://127.0.0.1:9191";
    const thirdResponse = await fetch(`${base}/admin/api/clash-bridge/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...bridge, apiBase: changedController }),
    });
    const third = (await thirdResponse.json()) as { settings: GatewaySettings };
    expect(thirdResponse.status).toBe(200);
    expect(third.settings.proxyPool.map((proxy) => proxy.id)).not.toEqual(ids);
    expect(third.settings.accounts.every((account) => account.proxyId === null)).toBe(true);
    expect(app.probes.get(ids[0])).toBeUndefined();

    const html = await (await fetch(`${base}/`)).text();
    expect(html).toContain("btn-import-clash");
    expect(html).toContain("/admin/api/clash-bridge/import");
  });
});
