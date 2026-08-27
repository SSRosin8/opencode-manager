import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FreeModelRegistry } from "../src/proxy/freeModels.js";
import { close, createApp, listen, type App } from "../src/server/http.js";
import { SettingsStore } from "../src/settings/store.js";

describe("Worker test API", () => {
  let dir: string | null = null;
  let app: App | null = null;

  afterEach(async () => {
    if (app) await close(app);
    if (dir) await rm(dir, { recursive: true, force: true });
    app = null;
    dir = null;
  });

  async function boot(upstreamStatus = 200, upstreamBody?: string) {
    dir = await mkdtemp(join(tmpdir(), "opencode-manager-worker-test-api-"));
    const store = new SettingsStore(join(dir, "settings.json"));
    await store.save({
      accounts: [
        { id: "missing-key", kind: "authenticated_zen", apiKey: "", proxyId: null, proxy: null },
        { id: "signed-in", kind: "authenticated_zen", apiKey: "zen-test-key", proxyId: "px", proxy: null },
        { id: "anonymous", kind: "anonymous_zen", apiKey: "must-not-be-used", proxyId: "px", proxy: null },
      ],
      proxyPool: [{
        id: "px", name: "Test proxy", type: "http", host: "192.0.2.10", port: 8080,
        enabled: true, source: "manual", usable: true, bridgeable: true,
      }],
    });
    const upstreamFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      expect(body.model).toBe("deepseek-v4-flash-free");
      return new Response(upstreamBody ?? JSON.stringify({ choices: [{ message: { content: "OK" } }] }), {
        status: upstreamStatus,
      });
    });
    const anonymousRequests: Array<{ authorization: string | null; model: string }> = [];
    const probeFetch = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === "POST") {
        anonymousRequests.push({
          authorization: new Headers(init.headers).get("authorization"),
          model: (JSON.parse(String(init.body)) as { model: string }).model,
        });
        return new Response(JSON.stringify({ choices: [] }), { status: 200 });
      }
      return new Response("203.0.113.10", { status: 200 });
    });
    app = await createApp({
      store,
      port: 0,
      fetchImpl: upstreamFetch,
      probeFetch,
      freeModels: new FreeModelRegistry({
        defaultIds: ["big-pickle", "deepseek-v4-flash-free"],
        cachePath: join(dir, "free-models.json"),
      }),
    });
    await listen(app);
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("missing address");
    return {
      base: `http://127.0.0.1:${address.port}`,
      upstreamFetch,
      probeFetch,
      anonymousRequests,
    };
  }

  it("rejects a signed-in Zen Worker without a key before network activity", async () => {
    const { base, upstreamFetch, probeFetch } = await boot();
    const response = await fetch(`${base}/admin/api/workers/missing-key/test`, {
      method: "POST",
      body: JSON.stringify({ model: "big-pickle" }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { type: "worker_api_key_required" },
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
    expect(probeFetch).not.toHaveBeenCalled();
  });

  it("uses a manually selected official free model for a signed-in Worker", async () => {
    const { base, upstreamFetch } = await boot();
    const response = await fetch(`${base}/admin/api/workers/signed-in/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "opencode/deepseek-v4-flash-free" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      workerId: "signed-in",
      model: "deepseek-v4-flash-free",
    });
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it("uses public authentication for an anonymous Worker even if a key is stored", async () => {
    const { base, upstreamFetch, anonymousRequests } = await boot();
    const response = await fetch(`${base}/admin/api/workers/anonymous/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "deepseek-v4-flash-free" }),
    });
    expect(response.status).toBe(200);
    expect(anonymousRequests).toEqual([{
      authorization: "Bearer public",
      model: "deepseek-v4-flash-free",
    }]);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("rejects unknown or paid models before network activity", async () => {
    const { base, upstreamFetch, probeFetch } = await boot();
    const response = await fetch(`${base}/admin/api/workers/signed-in/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-opus-paid" }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { type: "model_not_allowed" } });
    expect(upstreamFetch).not.toHaveBeenCalled();
    expect(probeFetch).not.toHaveBeenCalled();
  });

  it("does not expose upstream credentials or URLs in Worker test errors", async () => {
    const secret = "sk-test-never-return-this";
    const { base } = await boot(502, JSON.stringify({
      error: { type: "provider_error", message: `Bearer ${secret} at https://user:pass@example.invalid/private` },
    }));
    const response = await fetch(`${base}/admin/api/workers/signed-in/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "deepseek-v4-flash-free" }),
    });
    const text = await response.text();
    expect(response.status).toBe(502);
    expect(text).toContain("provider_error: upstream HTTP 502");
    expect(text).not.toContain(secret);
    expect(text).not.toContain("example.invalid");
  });
});
