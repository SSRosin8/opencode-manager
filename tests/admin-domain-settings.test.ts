import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { close, createApp, listen, type App } from "../src/server/http.js";
import { SettingsStore } from "../src/settings/store.js";
import { normalizeSubscriptions } from "../src/proxy/pool.js";

describe("admin domain settings and readiness", () => {
  let app: App | undefined;
  let dir = "";

  afterEach(async () => {
    if (app) await close(app);
    if (dir) await rm(dir, { recursive: true, force: true });
    app = undefined;
    dir = "";
  });

  async function boot(subscriptionFetch?: typeof fetch): Promise<string> {
    dir = await mkdtemp(join(tmpdir(), "opencode-manager-domain-settings-"));
    const store = new SettingsStore(join(dir, "settings.json"));
    await store.save({
      accounts: [],
      proxyPool: [],
      proxySubscriptions: [],
      relayAccessToken: "",
    });
    app = await createApp({ store, port: 0, subscriptionFetch });
    await listen(app);
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("no address");
    return `http://127.0.0.1:${address.port}`;
  }

  it("reports a structured next action from settings, probes, and scheduler state", async () => {
    const base = await boot();
    const empty = await (await fetch(`${base}/admin/api/status`)).json();
    expect(empty.readiness).toMatchObject({
      proxySourceConfigured: false,
      operational: false,
      readyWorkerCount: 0,
      nextAction: "add_proxy_source",
    });

    await app?.store.save({
      proxyPool: [{
        id: "bridge-node", name: "Bridge node", type: "vless", host: "192.0.2.10",
        port: 443, enabled: true, source: "manual", usable: false, bridgeable: true,
      }],
    });
    const bridge = await (await fetch(`${base}/admin/api/status`)).json();
    expect(bridge.readiness).toMatchObject({
      proxySourceConfigured: true,
      bridgeRequired: true,
      bridgeEnabled: false,
      nextAction: "configure_clash_bridge",
    });
  });

  it("patches gateway and Clash domains without overwriting Workers or proxies", async () => {
    const base = await boot();
    await app?.store.save({
      accounts: [{ id: "worker", apiKey: "test-key", proxyId: null, proxy: null }],
      proxyPool: [{
        id: "proxy", name: "Proxy", type: "http", host: "192.0.2.10", port: 8080,
        enabled: true, source: "manual", usable: true, bridgeable: true,
      }],
    });
    const gateway = await fetch(`${base}/admin/api/gateway-settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ relayAccessToken: "relay-test", port: 9988 }),
    });
    expect(gateway.status).toBe(200);
    const bridge = await fetch(`${base}/admin/api/clash-bridge`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, selectorGroup: "Proxy" }),
    });
    expect(bridge.status).toBe(200);
    expect(app?.store.get()).toMatchObject({
      relayAccessToken: "relay-test",
      port: 9988,
      accounts: [{ id: "worker" }],
      proxyPool: [{ id: "proxy" }],
      clashBridge: { enabled: true, selectorGroup: "Proxy" },
    });

    const invalid = await fetch(`${base}/admin/api/gateway-settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accounts: [] }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { type: "invalid_gateway_settings" } });
  });

  it("persists normalized subscription response size diagnostics", async () => {
    const body = "http://user:pass@192.0.2.20:8080#test\n";
    const base = await boot(async () => new Response(body, { status: 200 }));
    const added = await fetch(`${base}/admin/api/proxy-subscriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test", url: "https://example.invalid/sub" }),
    });
    const subscription = (await added.json()).subscription as { id: string };
    const fetched = await fetch(
      `${base}/admin/api/proxy-subscriptions/${encodeURIComponent(subscription.id)}/fetch`,
      { method: "POST" }
    );
    expect(fetched.status).toBe(200);
    const data = await fetched.json();
    expect(data.subscription.lastRawBytes).toBe(new TextEncoder().encode(body).byteLength);
    expect(app?.store.get().proxySubscriptions[0].lastRawBytes).toBe(data.rawBytes);

    expect(normalizeSubscriptions([{
      id: "sub", name: "sub", url: "https://example.invalid/sub", lastRawBytes: 12.9,
    }])[0].lastRawBytes).toBe(12);
    expect(normalizeSubscriptions([{
      id: "sub", name: "sub", url: "https://example.invalid/sub", lastRawBytes: -1,
    }])[0].lastRawBytes).toBe(0);
  });

  it("merges a slow subscription fetch into the latest settings without losing concurrent changes", async () => {
    let releaseFetch: (() => void) | undefined;
    let fetchStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { fetchStarted = resolve; });
    const release = new Promise<void>((resolve) => { releaseFetch = resolve; });
    const body = "http://user:pass@192.0.2.30:8080#subscription\n";
    const base = await boot(async () => {
      fetchStarted?.();
      await release;
      return new Response(body, { status: 200 });
    });
    const added = await fetch(`${base}/admin/api/proxy-subscriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "slow", url: "https://example.invalid/slow" }),
    });
    const subscription = (await added.json()).subscription as { id: string };
    const fetching = fetch(
      `${base}/admin/api/proxy-subscriptions/${encodeURIComponent(subscription.id)}/fetch`,
      { method: "POST" }
    );
    await started;
    await app?.store.addManualProxy({
      id: "concurrent", name: "Concurrent", type: "http",
      host: "192.0.2.40", port: 8080,
    });
    releaseFetch?.();
    expect((await fetching).status).toBe(200);
    expect(app?.store.get().proxyPool.map((proxy) => proxy.host)).toEqual(
      expect.arrayContaining(["192.0.2.30", "192.0.2.40"])
    );
  });

  it("does not recreate a subscription deleted while its fetch is in flight", async () => {
    let releaseFetch: (() => void) | undefined;
    let fetchStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { fetchStarted = resolve; });
    const release = new Promise<void>((resolve) => { releaseFetch = resolve; });
    const base = await boot(async () => {
      fetchStarted?.();
      await release;
      return new Response("http://user:pass@192.0.2.50:8080#late\n", { status: 200 });
    });
    const added = await fetch(`${base}/admin/api/proxy-subscriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "deleted", url: "https://example.invalid/deleted" }),
    });
    const subscription = (await added.json()).subscription as { id: string };
    const fetching = fetch(
      `${base}/admin/api/proxy-subscriptions/${encodeURIComponent(subscription.id)}/fetch`,
      { method: "POST" }
    );
    await started;
    expect((await fetch(
      `${base}/admin/api/proxy-subscriptions/${encodeURIComponent(subscription.id)}`,
      { method: "DELETE" }
    )).status).toBe(200);
    releaseFetch?.();
    expect((await fetching).status).toBe(404);
    expect(app?.store.get().proxySubscriptions).toHaveLength(0);
    expect(app?.store.get().proxyPool.some((proxy) => proxy.subscriptionId === subscription.id)).toBe(false);
  });
});
