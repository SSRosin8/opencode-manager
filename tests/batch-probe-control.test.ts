import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probePoolProxies, probePoolProxy } from "../src/proxy/probe.js";
import { ClashSwitchQueue } from "../src/proxy/clashBridge.js";
import type { PoolProxy } from "../src/proxy/pool.js";
import { SettingsStore } from "../src/settings/store.js";
import { close, createApp, listen, type App } from "../src/server/http.js";

function proxy(index: number, hostPrefix = "10.0.0"): PoolProxy {
  return {
    id: `node-${index}`,
    name: `node-${index}`,
    type: "http",
    host: `${hostPrefix}.${index + 1}`,
    port: 8080,
    enabled: true,
    source: "manual",
    usable: true,
    bridgeable: true,
  };
}

async function waitFor(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition not reached");
}

describe("batch probe controls", () => {
  let app: App | undefined;
  let dir = "";

  afterEach(async () => {
    if (app) await close(app);
    if (dir) await rm(dir, { recursive: true, force: true });
    app = undefined;
    dir = "";
  });

  async function boot(fetchImpl: NonNullable<Parameters<typeof createApp>[0]>["probeFetch"]): Promise<string> {
    dir = await mkdtemp(join(tmpdir(), "opencode-manager-batch-control-"));
    const store = new SettingsStore(join(dir, "settings.json"));
    await store.save({ accounts: [], proxyPool: Array.from({ length: 13 }, (_, i) => proxy(i)) });
    app = await createApp({ store, port: 0, probeFetch: fetchImpl });
    await listen(app);
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("no address");
    return `http://127.0.0.1:${address.port}/admin/api/proxy-pool/test-batch`;
  }

  it("pauses at node boundaries and resumes without losing completed results", async () => {
    let releaseInitial!: () => void;
    const initial = new Promise<void>((resolve) => { releaseInitial = resolve; });
    let getCount = 0;
    const url = await boot(async (_url, init) => {
      if (init.method === "GET") {
        getCount += 1;
        if (getCount <= 12) await initial;
        return new Response(`203.0.113.${getCount}`, { status: 200 });
      }
      return new Response(JSON.stringify({ choices: [] }), { status: 200 });
    });
    const batch = fetch(url, { method: "POST", body: "{}" });
    await waitFor(() => getCount === 12);
    expect(await (await fetch(`${url}/pause`, { method: "POST" })).json()).toMatchObject({
      progress: { running: true, paused: true },
    });
    releaseInitial();
    await waitFor(async () => {
      const status = await (await fetch(`${url}/status`)).json() as { completed: number };
      return status.completed === 12;
    });
    expect(getCount).toBe(12);
    expect(await (await fetch(`${url}/status`)).json()).toMatchObject({
      running: true, paused: true, completed: 12,
    });
    expect((await fetch(`${url}/resume`, { method: "POST" })).status).toBe(200);
    expect(await (await batch).json()).toMatchObject({
      cancelled: false,
      progress: { running: false, paused: false, completed: 13 },
    });
  });

  it("cancels pending nodes while retaining in-flight results", async () => {
    let getCount = 0;
    let abortCount = 0;
    const url = await boot(async (_url, init) => {
      if (init.method === "GET") {
        getCount += 1;
        if (getCount === 1) return new Response("198.51.100.1", { status: 200 });
        await new Promise<void>((_resolve, reject) => {
          const abort = () => {
            abortCount += 1;
            reject(new Error("aborted"));
          };
          if (init.signal?.aborted) abort();
          else init.signal?.addEventListener("abort", abort, { once: true });
        });
        throw new Error("unreachable");
      }
      return new Response(JSON.stringify({ choices: [] }), { status: 200 });
    });
    const batch = fetch(url, { method: "POST", body: "{}" });
    await waitFor(async () => {
      const status = await (await fetch(`${url}/status`)).json() as { completed: number };
      return status.completed === 1 && getCount >= 12;
    });
    expect(await (await fetch(`${url}/cancel`, { method: "POST" })).json()).toMatchObject({
      progress: { running: true, cancelRequested: true },
    });
    const response = await Promise.race([
      batch,
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("cancel timed out")), 500)),
    ]);
    const data = await response.json() as {
      cancelled: boolean;
      results: Array<{ id: string }>;
      progress: { running: boolean; cancelled: boolean; completed: number };
    };
    expect(data.cancelled).toBe(true);
    expect(data.results).toHaveLength(1);
    expect(data.progress).toMatchObject({ running: false, cancelled: true, completed: 1 });
    expect(abortCount).toBe(getCount - 1);
  });

  it("does not report absent Controller results after cancellation", async () => {
    const bridge = {
      enabled: true,
      apiBase: "http://127.0.0.1:9090",
      apiSecret: "",
      localProxyHost: "127.0.0.1",
      localProxyPort: 7890,
      selectorGroup: "Proxy",
    };
    const nodes = Array.from({ length: 17 }, (_, index): PoolProxy => ({
      ...proxy(index),
      type: "anytls",
      source: "controller",
      usable: false,
      clashNodeName: `Controller ${index}`,
    }));
    let checkpoints = 0;
    const reported: string[] = [];
    const results = await probePoolProxies(nodes, bridge, {
      fastController: true,
      verifyEgressCount: nodes.length,
      checkpoint: async () => ++checkpoints <= 16,
      bridgeFetch: (async () => new Response(JSON.stringify({ delay: 10 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch,
      onResult: (result) => { reported.push(result.id); },
    });
    expect(results).toHaveLength(0);
    expect(reported).toHaveLength(0);
    expect(reported).not.toContain("node-16");
  });

  it("does not switch a Clash node whose queued probe was cancelled", async () => {
    const bridge = {
      enabled: true,
      apiBase: "http://127.0.0.1:9090",
      apiSecret: "",
      localProxyHost: "127.0.0.1",
      localProxyPort: 7890,
      selectorGroup: "Proxy",
    };
    const nodes = [0, 1].map((index): PoolProxy => ({
      ...proxy(index),
      type: "anytls",
      usable: false,
      clashNodeName: `Controller ${index}`,
    }));
    const control = new AbortController();
    const queue = new ClashSwitchQueue();
    const switched: string[] = [];
    let started = false;
    const bridgeFetch = (async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        switched.push((JSON.parse(String(init.body)) as { name: string }).name);
      }
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const fetchImpl = async (_url: string, init: RequestInit) => {
      started = true;
      await new Promise<void>((_resolve, reject) => {
        const abort = () => reject(new Error("aborted"));
        if (init.signal?.aborted) abort();
        else init.signal?.addEventListener("abort", abort, { once: true });
      });
      return new Response(null, { status: 204 });
    };
    const runs = nodes.map((node) => probePoolProxy(node, bridge, {
      clashQueue: queue,
      bridgeFetch,
      fetchImpl,
      signal: control.signal,
    }));
    await waitFor(() => started);
    control.abort();
    await Promise.all(runs);
    expect(switched).toEqual(["Controller 0"]);
  });
});
