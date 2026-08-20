import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProbeResultCache } from "../src/proxy/probe.js";
import { SettingsStore } from "../src/settings/store.js";
import { close, createApp, listen, type App } from "../src/server/http.js";

describe("delete all proxies", () => {
  let app: App | undefined;
  let dir = "";

  afterEach(async () => {
    if (app) await close(app);
    if (dir) await rm(dir, { recursive: true, force: true });
    app = undefined;
    dir = "";
  });

  async function boot(probeFetch?: NonNullable<Parameters<typeof createApp>[0]>["probeFetch"]): Promise<string> {
    dir = await mkdtemp(join(tmpdir(), "opencode-manager-delete-proxies-"));
    const store = new SettingsStore(join(dir, "settings.json"));
    await store.save({
      accounts: [
        { id: "bound", apiKey: "test-key", proxyId: "proxy-a", proxy: null },
        { id: "unbound", apiKey: "other-key", proxyId: null, proxy: null },
      ],
      proxyPool: [
        {
          id: "proxy-a", name: "Proxy A", type: "http", host: "192.0.2.10",
          port: 8080, enabled: true, source: "manual", usable: true,
        },
        {
          id: "proxy-b", name: "Proxy B", type: "socks5", host: "192.0.2.11",
          port: 1080, enabled: true, source: "subscription", subscriptionId: "sub-a",
          usable: true,
        },
      ],
      proxySubscriptions: [{
        id: "sub-a", name: "Test subscription", url: "https://example.invalid/sub",
        enabled: true, lastFetchedAt: null, lastError: null, lastImportCount: 1,
      }],
    });
    const probes = new ProbeResultCache();
    probes.set({
      id: "proxy-a", ok: true, latencyMs: 10, error: null,
      testedAt: "2026-08-20T00:00:00.000Z", health: "healthy", egressIp: "192.0.2.20",
    });
    app = await createApp({ store, probes, probeFetch, port: 0 });
    await listen(app);
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("no address");
    return `http://127.0.0.1:${address.port}`;
  }

  it("clears proxies and probe results while retaining Workers and subscriptions", async () => {
    const base = await boot();
    const response = await fetch(`${base}/admin/api/proxy-pool`, { method: "DELETE" });
    expect(response.status).toBe(200);
    const settings = await response.json() as {
      accounts: Array<{ id: string; proxyId: string | null }>;
      proxyPool: unknown[];
      proxySubscriptions: unknown[];
    };
    expect(settings.proxyPool).toEqual([]);
    expect(settings.accounts).toEqual([
      expect.objectContaining({ id: "bound", proxyId: null }),
      expect.objectContaining({ id: "unbound", proxyId: null }),
    ]);
    expect(settings.proxySubscriptions).toHaveLength(1);
    expect(app?.probes.getAll()).toEqual({});

    const status = await (await fetch(`${base}/admin/api/status`)).json() as {
      proxyPoolCount: number;
    };
    expect(status.proxyPoolCount).toBe(0);
  });

  it("rejects deletion while a batch test is running", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const base = await boot(async (_url, init) => {
      if (init.method === "GET") await blocked;
      return init.method === "POST"
        ? new Response(JSON.stringify({ choices: [] }), { status: 200 })
        : new Response("192.0.2.20", { status: 200 });
    });
    const batch = fetch(`${base}/admin/api/proxy-pool/test-batch`, {
      method: "POST", body: "{}",
    });
    try {
      for (let attempt = 0; attempt < 20; attempt++) {
        const status = await (await fetch(
          `${base}/admin/api/proxy-pool/test-batch/status`
        )).json() as { running: boolean };
        if (status.running) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      for (const path of ["", "/proxy-a"]) {
        const response = await fetch(`${base}/admin/api/proxy-pool${path}`, {
          method: "DELETE",
        });
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({
          error: { type: "batch_probe_running" },
        });
      }
      expect(app?.store.get().proxyPool).toHaveLength(2);
      expect(app?.probes.get("proxy-a")).toBeTruthy();
    } finally {
      release();
      await batch;
    }
  });

  it("renders the destructive action and confirmation copy", async () => {
    const base = await boot();
    const html = await (await fetch(`${base}/`)).text();
    expect(html).toContain('id="btn-remove-all-proxies"');
    expect(html).toContain("confirmRemoveAllProxies");
    expect(html).toContain('fetch("/admin/api/proxy-pool", { method: "DELETE" })');
  });
});
