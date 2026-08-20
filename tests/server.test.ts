/**
 * Integration-ish tests: real createApp entry, mock only at network boundary.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, close, listen, type App } from "../src/server/http.js";
import { SettingsStore } from "../src/settings/store.js";
import { FreeModelRegistry } from "../src/proxy/freeModels.js";

let app: App | null = null;

afterEach(async () => {
  if (app) {
    await close(app);
    app = null;
  }
});

async function bootMocked(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, freeModels?: FreeModelRegistry) {
  const dir = await mkdtemp(join(tmpdir(), "opencode-manager-"));
  const store = new SettingsStore(join(dir, "settings.json"));
  await store.save({
    baseUrl: "https://opencode.ai/zen/v1",
    accounts: [{ id: "t", apiKey: "test-key", proxyId: null, proxy: null }],
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
    synthesizeCliHeaders: true,
  });
  app = await createApp({
    store,
    port: 0,
    fetchImpl,
    freeModels: freeModels ?? new FreeModelRegistry({ cachePath: join(dir, "free-models.json") }),
  });
  await listen(app);
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  return { port: addr.port, dir, store };
}

describe("gateway HTTP entry", () => {
  it("keeps /v1 routes open when no relay access token is configured", async () => {
    const { port, dir } = await bootMocked(async (url) => {
      if (String(url).endsWith("/models")) {
        return new Response(JSON.stringify({ object: "list", data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", { status: 404 });
    });

    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/models`);
      expect(res.status).toBe(200);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects request bodies larger than one MiB", async () => {
    const { port, dir } = await bootMocked(async () => {
      throw new Error("oversized requests must not reach upstream");
    });
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "x".repeat(1024 * 1024 + 1),
      });
      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({
        error: { type: "request_body_too_large" },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("protects all relay route aliases with X-OC-Relay-Key when configured", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opencode-manager-"));
    const store = new SettingsStore(join(dir, "settings.json"));
    await store.save({
      relayAccessToken: "relay-secret",
      accounts: [{ id: "t", apiKey: "test-key", proxyId: null, proxy: null }],
    });
    let upstreamCalls = 0;
    app = await createApp({
      store,
      port: 0,
      fetchImpl: async (url, init) => {
        upstreamCalls++;
        expect(new Headers(init?.headers).get("X-OC-Relay-Key")).toBeNull();
        if (String(url).endsWith("/models")) {
          return new Response(JSON.stringify({ object: "list", data: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("{}", { status: 404 });
      },
      freeModels: new FreeModelRegistry({ cachePath: join(dir, "free-models.json") }),
    });
    await listen(app);
    const addr = app.server.address();
    if (!addr || typeof addr === "string") throw new Error("no address");
    const port = addr.port;

    try {
      const missing = await fetch(`http://127.0.0.1:${port}/v1/models`);
      expect(missing.status).toBe(401);
      expect(await missing.json()).toMatchObject({
        error: { type: "authentication_error" },
      });

      const incorrect = await fetch(`http://127.0.0.1:${port}/v1/models`, {
        headers: { "X-OC-Relay-Key": "wrong" },
      });
      expect(incorrect.status).toBe(401);
      expect(upstreamCalls).toBe(0);

      const aliasMissing = await fetch(`http://127.0.0.1:${port}/models`);
      expect(aliasMissing.status).toBe(401);

      const chatAliasMissing = await fetch(`http://127.0.0.1:${port}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "big-pickle", messages: [] }),
      });
      expect(chatAliasMissing.status).toBe(401);

      const authorized = await fetch(`http://127.0.0.1:${port}/v1/models`, {
        headers: { "X-OC-Relay-Key": "relay-secret" },
      });
      expect(authorized.status).toBe(200);
      expect(upstreamCalls).toBe(1);

      const health = await fetch(`http://127.0.0.1:${port}/health`);
      expect(health.status).toBe(200);
      const admin = await fetch(`http://127.0.0.1:${port}/admin/api/settings`);
      expect(admin.status).toBe(200);
      expect(admin.headers.get("access-control-allow-origin")).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("serves admin HTML and settings read/write", async () => {
    const { port, dir } = await bootMocked(async () => new Response("{}", { status: 200 }));
    try {
      const htmlRes = await fetch(`http://127.0.0.1:${port}/`);
      expect(htmlRes.status).toBe(200);
      const html = await htmlRes.text();
      expect(html).toContain("opencode-manager");
      expect(html).toContain("/admin/api/settings");

      const getRes = await fetch(`http://127.0.0.1:${port}/admin/api/settings`);
      expect(getRes.status).toBe(200);
      const settings = (await getRes.json()) as { baseUrl: string; accounts: unknown[] };
      expect(settings.baseUrl).toContain("opencode.ai/zen");
      expect(settings.accounts.length).toBeGreaterThan(0);

      const putRes = await fetch(`http://127.0.0.1:${port}/admin/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...settings,
          baseUrl: "https://opencode.ai/zen/v1",
          accounts: [
            { id: "a1", apiKey: "aaa", proxy: null },
            { id: "a2", apiKey: "bbb", proxy: null },
          ],
        }),
      });
      expect(putRes.status).toBe(200);
      const saved = (await putRes.json()) as { accounts: Array<{ id: string }> };
      expect(saved.accounts.map((a) => a.id)).toEqual(["a1", "a2"]);

      const duplicateRes = await fetch(`http://127.0.0.1:${port}/admin/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accounts: [
            { id: "anon-a", kind: "anonymous_zen", apiKey: "", proxyId: "same-proxy" },
            { id: "anon-b", kind: "anonymous_zen", apiKey: "", proxyId: "same-proxy" },
          ],
        }),
      });
      expect(duplicateRes.status).toBe(400);

      const duplicateIds = await fetch(`http://127.0.0.1:${port}/admin/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accounts: [
            { id: "same", apiKey: "a", proxy: null },
            { id: "same", apiKey: "b", proxy: null },
          ],
        }),
      });
      expect(duplicateIds.status).toBe(400);
      expect(await duplicateIds.json()).toMatchObject({ error: { type: "invalid_worker_ids" } });
      expect(await duplicateRes.json()).toMatchObject({
        error: { type: "duplicate_worker_egress" },
      });

      const statusRes = await fetch(`http://127.0.0.1:${port}/admin/api/status`);
      expect(statusRes.status).toBe(200);
      const status = (await statusRes.json()) as { running: boolean; accountCount: number };
      expect(status.running).toBe(true);
      expect(status.accountCount).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("persists an explicitly empty Worker list and reports a clear gateway error", async () => {
    const { port, dir, store } = await bootMocked(async () => {
      throw new Error("empty Worker pools must not call upstream");
    });
    try {
      const saveRes = await fetch(`http://127.0.0.1:${port}/admin/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts: [] }),
      });
      expect(saveRes.status).toBe(200);
      expect(await saveRes.json()).toMatchObject({ accounts: [] });
      expect(app?.upstream.rotator.getAccounts()).toEqual([]);

      const persisted = JSON.parse(await readFile(store.path, "utf8")) as { accounts: unknown[] };
      expect(persisted.accounts).toEqual([]);
      const reloaded = new SettingsStore(store.path);
      expect((await reloaded.load()).accounts).toEqual([]);

      const models = await fetch(`http://127.0.0.1:${port}/v1/models`);
      expect(models.status).toBe(503);
      expect(await models.json()).toMatchObject({
        error: { type: "no_workers_configured" },
      });

      const chat = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "big-pickle", messages: [{ role: "user", content: "x" }] }),
      });
      expect(chat.status).toBe(503);
      expect(await chat.json()).toMatchObject({
        error: { type: "no_workers_configured" },
      });

      const status = await fetch(`http://127.0.0.1:${port}/admin/api/status`);
      expect(await status.json()).toMatchObject({
        accountCount: 0,
        enabledAccountCount: 0,
        readyAccountCount: 0,
        workers: [],
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("distinguishes an all-disabled Worker pool from an empty pool", async () => {
    const { port, dir, store } = await bootMocked(async () => {
      throw new Error("disabled Workers must not call upstream");
    });
    try {
      await store.save({
        accounts: [{ id: "paused", apiKey: "", kind: "anonymous_zen", enabled: false }],
      });
      app?.upstream.updateSettings(store.get());

      const response = await fetch(`http://127.0.0.1:${port}/v1/models`);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: { type: "no_enabled_workers" },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("persists routing strategy and enables or disables one worker", async () => {
    const { port, dir } = await bootMocked(async () => new Response("{}", { status: 200 }));
    try {
      const settingsRes = await fetch(`http://127.0.0.1:${port}/admin/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routingStrategy: "authenticated_first",
          accounts: [
            { id: "login", apiKey: "signed-in", kind: "authenticated_zen" },
            { id: "anon", apiKey: "", kind: "anonymous_zen", enabled: false },
          ],
        }),
      });
      expect(settingsRes.status).toBe(200);
      expect(await settingsRes.json()).toMatchObject({
        routingStrategy: "authenticated_first",
        accounts: [
          { id: "login", enabled: true },
          { id: "anon", enabled: false },
        ],
      });

      const enableRes = await fetch(`http://127.0.0.1:${port}/admin/api/workers/anon`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      });
      expect(enableRes.status).toBe(200);
      expect(await enableRes.json()).toMatchObject({
        ok: true,
        worker: { id: "anon", enabled: true },
        routingStrategy: "authenticated_first",
      });

      const statusRes = await fetch(`http://127.0.0.1:${port}/admin/api/status`);
      const status = (await statusRes.json()) as {
        routingStrategy: string;
        workers: Array<{ accountId: string; enabled: boolean }>;
      };
      expect(status.routingStrategy).toBe("authenticated_first");
      expect(status.workers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ accountId: "login", enabled: true }),
          expect.objectContaining({ accountId: "anon", enabled: true }),
        ])
      );

      const invalidRes = await fetch(`http://127.0.0.1:${port}/admin/api/workers/anon`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: "no" }),
      });
      expect(invalidRes.status).toBe(400);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("proxies models and non-stream chat with OpenAI-shaped bodies", async () => {
    const { port, dir } = await bootMocked(async (url, init) => {
      if (String(url).endsWith("/models")) {
        return new Response(
          JSON.stringify({
            object: "list",
            data: [{ id: "big-pickle", object: "model", owned_by: "opencode" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (String(url).includes("chat/completions")) {
        const body = JSON.parse(String(init?.body || "{}"));
        expect(body.model).toBe("big-pickle");
        expect(body.messages).toBeTruthy();
        return new Response(
          JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "hello from mock" },
                finish_reason: "stop",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("not found", { status: 404 });
    });

    try {
      const modelsRes = await fetch(`http://127.0.0.1:${port}/v1/models`);
      expect(modelsRes.status).toBe(200);
      const models = (await modelsRes.json()) as { object: string; data: Array<{ id: string }> };
      expect(models.object).toBe("list");
      expect(models.data[0].id).toBe("big-pickle");

      const chatRes = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "big-pickle",
          messages: [{ role: "user", content: "hi" }],
          stream: false,
        }),
      });
      expect(chatRes.status).toBe(200);
      const chat = (await chatRes.json()) as {
        object: string;
        choices: Array<{ message: { content: string } }>;
      };
      expect(chat.object).toBe("chat.completion");
      expect(chat.choices[0].message.content).toBe("hello from mock");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("streams SSE chat frames through without re-encoding payload", async () => {
    const frames =
      'data: {"id":"1","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hi"}}]}\n\n' +
      "data: [DONE]\n\n";

    const { port, dir } = await bootMocked(async (url) => {
      if (String(url).includes("chat/completions")) {
        return new Response(frames, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      return new Response("{}", { status: 404 });
    }, new FreeModelRegistry({ defaultIds: ["hy3-free"] }));

    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "hy3-free",
          messages: [{ role: "user", content: "x" }],
          stream: true,
        }),
      });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("chat.completion.chunk");
      expect(text).toContain("[DONE]");
      expect(text).toContain("Hi");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  /**
   * Method 2: full HTTP path — two keyless workers (like live OpenCode free),
   * first upstream 429, second 200; client sees success; readyCount drops.
   */
  it("HTTP path: keyless workers rotate on 429 then succeed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opencode-manager-"));
    const store = new SettingsStore(join(dir, "settings.json"));
    await store.save({
      baseUrl: "https://opencode.ai/zen/v1",
      accounts: [
        { id: "default", apiKey: "", proxyId: null, proxy: null },
        { id: "worker-2", apiKey: "", proxyId: null, proxy: null },
      ],
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
      synthesizeCliHeaders: false,
    });

    let chatCalls = 0;
    const authSeen: Array<string | undefined> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      if (String(url).includes("chat/completions")) {
        chatCalls++;
        const h = init?.headers as Record<string, string> | undefined;
        authSeen.push(h?.Authorization);
        if (chatCalls === 1) {
          return new Response(JSON.stringify({ error: { message: "rate limit" } }), {
            status: 429,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({
            id: "chatcmpl-rotated",
            object: "chat.completion",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "ok-after-rotate" },
                finish_reason: "stop",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("{}", { status: 404 });
    };

    app = await createApp({ store, port: 0, fetchImpl });
    await listen(app);
    const addr = app.server.address();
    if (!addr || typeof addr === "string") throw new Error("no address");
    const port = addr.port;

    try {
      const before = (await (
        await fetch(`http://127.0.0.1:${port}/admin/api/status`)
      ).json()) as { readyAccountCount: number; accountCount: number };
      expect(before.accountCount).toBe(2);
      expect(before.readyAccountCount).toBe(2);

      const chatRes = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "big-pickle",
          messages: [{ role: "user", content: "ping" }],
          stream: false,
        }),
      });
      expect(chatRes.status).toBe(200);
      const chat = (await chatRes.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      expect(chat.choices[0].message.content).toBe("ok-after-rotate");

      expect(chatCalls).toBe(2);
      expect(authSeen.every((a) => a === "Bearer public")).toBe(true);

      const after = (await (
        await fetch(`http://127.0.0.1:${port}/admin/api/status`)
      ).json()) as {
        readyAccountCount: number;
        accountCount: number;
        lastRequestStatus: number;
      };
      expect(after.accountCount).toBe(2);
      expect(after.readyAccountCount).toBe(1);
      expect(after.lastRequestStatus).toBe(200);
      expect(after.readyAccountCount).toBe(1);
      expect(after.lastRequestStatus).toBe(200);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("serves only free models: filters list and rejects paid chat", async () => {
    const { port, dir } = await bootMocked(async (url, init) => {
      if (String(url).endsWith("/models")) {
        return new Response(
          JSON.stringify({
            object: "list",
            data: [
              { id: "big-pickle", object: "model", owned_by: "opencode" },
              { id: "gpt-5.5-pro", object: "model", owned_by: "opencode" },
              { id: "claude-opus-5", object: "model", owned_by: "opencode" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (String(url).includes("chat/completions")) {
        const body = JSON.parse(String(init?.body || "{}"));
        return new Response(
          JSON.stringify({
            id: "chatcmpl-free",
            object: "chat.completion",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "ok-" + body.model },
                finish_reason: "stop",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("nope", { status: 404 });
    });

    try {
      // /v1/models exposes only the free model
      const modelsRes = await fetch(`http://127.0.0.1:${port}/v1/models`);
      expect(modelsRes.status).toBe(200);
      const models = (await modelsRes.json()) as {
        object: string;
        data: Array<{ id: string }>;
      };
      expect(models.object).toBe("list");
      expect(models.data.map((m) => m.id)).toEqual(["big-pickle"]);

      // chat to a free model passes through
      const okRes = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "big-pickle",
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      expect(okRes.status).toBe(200);

      const prefixedRes = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "opencode/big-pickle",
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      expect(prefixedRes.status).toBe(200);
      expect(await prefixedRes.json()).toMatchObject({
        choices: [{ message: { content: "ok-big-pickle" } }],
      });

      // chat to a paid model is rejected up front (no upstream call)
      const paidRes = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5.5-pro",
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      expect(paidRes.status).toBe(403);
      const paidBody = (await paidRes.json()) as { error: { type: string } };
      expect(paidBody.error.type).toBe("model_not_allowed");

      // admin free-models endpoint reflects the registry
      const fm = (await (
        await fetch(`http://127.0.0.1:${port}/admin/api/free-models`)
      ).json()) as { count: number; usingBaseline: boolean };
      expect(fm.count).toBeGreaterThan(0);
      expect(fm.usingBaseline).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
