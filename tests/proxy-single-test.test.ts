/** Regression tests for incremental proxy tests and automatic Worker creation. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, close, listen, type App } from "../src/server/http.js";
import { SettingsStore, type GatewaySettings } from "../src/settings/store.js";
import type { PoolProxy } from "../src/proxy/pool.js";

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

describe("incremental proxy tests and automatic Workers", () => {
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

  async function boot(
    pool: PoolProxy[],
    probeFetch: (
      url: string,
      init: RequestInit & { dispatcher?: unknown }
    ) => Promise<Response> = async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return new Response(null, { status: 204 });
    }
  ) {
    dir = await mkdtemp(join(tmpdir(), "opencode-manager-proxy-single-"));
    const store = new SettingsStore(join(dir, "settings.json"));
    const base: GatewaySettings = {
      baseUrl: "https://opencode.ai/zen/v1",
      relayAccessToken: "",
      synthesizeCliHeaders: false,
      cliUserAgent: "opencode-cli/1.0.0",
      cliClient: "cli",
      cliProject: "default",
      accounts: [{ id: "w1", apiKey: "k1", proxyId: null, proxy: null }],
      routingStrategy: "anonymous_first",
      proxyPool: pool,
      proxySubscriptions: [],
      clashBridge: bridgeOff,
      port: 0,
    };
    await store.save(base);
    app = await createApp({ store, port: 0, probeFetch });
    await listen(app);
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("no address");
    return { port: address.port, store };
  }

  it("single tests create only unique usable anonymous workers", async () => {
    let available = true;
    const { port } = await boot([
      px({ id: "usable", name: "MX", type: "http", host: "10.0.0.1", port: 8080 }),
      px({ id: "bad", name: "US", type: "http", host: "10.0.0.2", port: 8080 }),
    ], async (_url, init) => {
      if (!available && init.method === "GET") throw new Error("blocked");
      return init.method === "POST"
        ? new Response(JSON.stringify({ choices: [] }), { status: 200 })
        : new Response("203.0.113.90", { status: 200 });
    });
    const base = `http://127.0.0.1:${port}/admin/api/proxy-pool`;
    const first = await (await fetch(`${base}/usable/test`, { method: "POST" })).json() as {
      autoWorkers: { added: number; addedIds: string[] }; settings: GatewaySettings;
    };
    expect(first.autoWorkers).toEqual({ added: 1, addedIds: ["anonymous-zen-usable"] });
    expect(first.settings.accounts).toContainEqual(expect.objectContaining({
      id: "anonymous-zen-usable", kind: "anonymous_zen", proxyId: "usable",
    }));
    const repeat = await (await fetch(`${base}/usable/test`, { method: "POST" })).json() as {
      autoWorkers: { added: number }; settings: GatewaySettings;
    };
    expect(repeat.autoWorkers.added).toBe(0);
    available = false;
    const bad = await (await fetch(`${base}/bad/test`, { method: "POST" })).json() as {
      autoWorkers: { added: number }; settings: GatewaySettings;
    };
    expect(bad.autoWorkers.added).toBe(0);
    expect(bad.settings.accounts).toHaveLength(2);
  });

  it("keeps workers created by concurrent single tests", async () => {
    let egress = 90;
    const { port } = await boot([
      px({ id: "a", name: "A", type: "http", host: "10.0.0.1", port: 8080 }),
      px({ id: "b", name: "B", type: "http", host: "10.0.0.2", port: 8080 }),
    ], async (_url, init) => init.method === "POST"
      ? new Response(JSON.stringify({ choices: [] }), { status: 200 })
      : new Response(`203.0.113.${++egress}`, { status: 200 }));
    const base = `http://127.0.0.1:${port}`;
    await Promise.all(["a", "b"].map((id) =>
      fetch(`${base}/admin/api/proxy-pool/${id}/test`, { method: "POST" })));
    const saved = await (await fetch(`${base}/admin/api/settings`)).json() as GatewaySettings;
    expect(saved.accounts.map((account) => account.proxyId).filter(Boolean).sort()).toEqual(["a", "b"]);
  });

  it("runs twelve direct probes concurrently through the batch API", async () => {
    let active = 0;
    let maxActive = 0;
    const pool = Array.from({ length: 12 }, (_, index) =>
      px({
        id: `direct-${index}`,
        name: `direct-${index}`,
        type: "http",
        host: `10.0.0.${index + 1}`,
        port: 8080,
      })
    );
    const { port } = await boot(pool, async (_url, init) => {
      if (init.method === "POST") return new Response(JSON.stringify({ choices: [] }), { status: 200 });
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 25));
      active--;
      return new Response("203.0.113.10", { status: 200 });
    });

    const response = await fetch(
      `http://127.0.0.1:${port}/admin/api/proxy-pool/test-batch`,
      { method: "POST", body: "{}" }
    );
    expect(response.status).toBe(200);
    expect(maxActive).toBe(12);
  });

  it("batch test creates one anonymous worker per usable egress without duplicates", async () => {
    const { port, store } = await boot([
      px({ id: "usable", name: "Mexico", type: "http", host: "10.0.0.10", port: 8080 }),
      px({ id: "same-egress", name: "Mexico 2", type: "http", host: "10.0.0.12", port: 8080 }),
      px({ id: "disabled", name: "US", type: "http", host: "10.0.0.11", port: 8080, enabled: false }),
    ], async (_url, init) => init.method === "POST"
      ? new Response(JSON.stringify({ choices: [] }), { status: 200, headers: { "Content-Type": "application/json" } })
      : new Response("203.0.113.80", { status: 200 }));
    const url = `http://127.0.0.1:${port}/admin/api/proxy-pool/test-batch`;

    const first = await fetch(url, { method: "POST", body: "{}" });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      autoWorkers: { added: number; addedIds: string[] }; settings: GatewaySettings;
    };
    expect(firstBody.autoWorkers).toEqual({ added: 1, addedIds: ["anonymous-zen-usable"] });
    expect(firstBody.settings.accounts).toContainEqual(expect.objectContaining({
      id: "anonymous-zen-usable", kind: "anonymous_zen", apiKey: "", proxyId: "usable",
    }));

    const disabledAccounts = firstBody.settings.accounts.map((account) =>
      account.id === "anonymous-zen-usable" ? { ...account, enabled: false } : account
    );
    await store.save({ accounts: disabledAccounts });
    const second = await fetch(url, { method: "POST", body: JSON.stringify({ ids: ["usable"] }) });
    const secondBody = (await second.json()) as {
      autoWorkers: { added: number; addedIds: string[] }; settings: GatewaySettings;
    };
    expect(secondBody.autoWorkers).toEqual({ added: 0, addedIds: [] });
    expect(secondBody.settings.accounts).toHaveLength(2);
    expect(secondBody.settings.accounts.find((account) => account.id === "anonymous-zen-usable")?.enabled).toBe(false);
    expect(app?.upstream.rotator.getAccounts().map((account) => account.id)).toContain("anonymous-zen-usable");
  });

  it("batch test repopulates an empty Worker list with every unique usable egress", async () => {
    dir = await mkdtemp(join(tmpdir(), "opencode-manager-probe-empty-workers-"));
    const store = new SettingsStore(join(dir, "settings.json"));
    await store.save({
      baseUrl: "https://opencode.ai/zen/v1",
      relayAccessToken: "",
      synthesizeCliHeaders: false,
      cliUserAgent: "opencode-cli/1.0.0",
      cliClient: "cli",
      cliProject: "default",
      routingStrategy: "anonymous_first",
      accounts: [],
      proxyPool: [
        px({ id: "mexico", name: "Mexico", type: "http", host: "10.0.0.10", port: 8080 }),
        px({ id: "japan", name: "Japan", type: "http", host: "10.0.0.11", port: 8080 }),
      ],
      proxySubscriptions: [],
      clashBridge: bridgeOff,
      port: 0,
    });
    let egressIndex = 0;
    const probeFetch = vi.fn(async (_url: string, init: RequestInit & { dispatcher?: unknown }) => {
      if (init.method === "POST") return new Response(JSON.stringify({ choices: [] }), { status: 200 });
      return new Response(`203.0.113.${80 + egressIndex++}`, { status: 200 });
    });
    app = await createApp({ store, port: 0, probeFetch });
    await listen(app);
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("no address");

    const response = await fetch(
      `http://127.0.0.1:${address.port}/admin/api/proxy-pool/test-batch`,
      { method: "POST", body: "{}" }
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      autoWorkers: { added: number; addedIds: string[] }; settings: GatewaySettings;
    };
    expect(body.autoWorkers).toEqual({
      added: 2,
      addedIds: ["anonymous-zen-mexico", "anonymous-zen-japan"],
    });
    expect(body.settings.accounts).toEqual([
      expect.objectContaining({ id: "anonymous-zen-mexico", proxyId: "mexico" }),
      expect.objectContaining({ id: "anonymous-zen-japan", proxyId: "japan" }),
    ]);
    expect(app.upstream.rotator.getAccounts()).toHaveLength(2);
  });
});
