/**
 * Upstream client tests with mock fetch at network boundary.
 */
import { describe, expect, it, vi } from "vitest";
import { UpstreamClient } from "../src/proxy/upstream.js";
import type { GatewaySettings } from "../src/settings/store.js";
import { transformRequestBody } from "../src/relay/index.js";

function baseSettings(over: Partial<GatewaySettings> = {}): GatewaySettings {
  return {
    baseUrl: "https://opencode.ai/zen/v1",
    synthesizeCliHeaders: false,
    cliUserAgent: "opencode-cli/1.0.0",
    cliClient: "cli",
    cliProject: "default",
    accounts: [
      { id: "k1", apiKey: "key-one", proxyId: null, proxy: null },
      { id: "k2", apiKey: "key-two", proxyId: null, proxy: null },
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
    port: 9876,
    ...over,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("UpstreamClient chatCompletions", () => {
  it("sends transformed body to zen chat URL with Bearer key", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init || {} });
      return jsonResponse(200, {
        id: "chatcmpl-1",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      });
    });

    const client = new UpstreamClient(baseSettings(), fetchImpl);
    const body = {
      model: "big-pickle",
      messages: [{ role: "user", content: "ping" }],
      client_metadata: { drop: true },
      temperature: 0.1,
    };
    const result = await client.chatCompletions({ body, stream: false });

    expect(result.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://opencode.ai/zen/v1/chat/completions");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Bearer key-/);
    const sent = JSON.parse(String(calls[0].init.body));
    // shipped transform applied
    expect(sent).toEqual(transformRequestBody("big-pickle", body, false));
    expect(sent).not.toHaveProperty("client_metadata");
    expect(sent.temperature).toBe(0.1);
  });

  it("rotates to next key on 429", async () => {
    const authHeaders: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const h = init?.headers as Record<string, string>;
      authHeaders.push(h.Authorization);
      if (authHeaders.length === 1) {
        return jsonResponse(429, { error: { message: "rate limit" } });
      }
      return jsonResponse(200, {
        id: "ok",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: "done" } }],
      });
    });

    const client = new UpstreamClient(baseSettings(), fetchImpl);
    const result = await client.chatCompletions({
      body: { model: "hy3-free", messages: [{ role: "user", content: "x" }] },
      stream: false,
    });

    expect(result.status).toBe(200);
    expect(authHeaders.length).toBeGreaterThanOrEqual(2);
    expect(new Set(authHeaders).size).toBeGreaterThanOrEqual(2);
  });

  it("sticks to the same worker across successful chat requests", async () => {
    const accountIds: string[] = [];
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        id: "ok",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: "done" } }],
      })
    );

    const client = new UpstreamClient(baseSettings(), fetchImpl);
    for (let i = 0; i < 4; i++) {
      const result = await client.chatCompletions({
        body: { model: "big-pickle", messages: [{ role: "user", content: `n${i}` }] },
        stream: false,
      });
      expect(result.status).toBe(200);
      accountIds.push(result.accountId);
    }

    expect(new Set(accountIds).size).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  /**
   * Matches OmniRoute OpenCode free multi-account: empty apiKey, rotate on 429
   * by account slot (fingerprint/id + proxy), not by Bearer key.
   */
  it("rotates keyless free workers on 429 (empty apiKey, per-proxy slots)", async () => {
    const callAccountIds: string[] = [];
    let callN = 0;
    const fetchImpl = vi.fn(async () => {
      callN++;
      // First worker exhausted → 429; second succeeds
      if (callN === 1) {
        return jsonResponse(429, { error: { message: "rate limit" } });
      }
      return jsonResponse(200, {
        id: "ok",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: "from-worker-2" } }],
      });
    });

    const client = new UpstreamClient(
      baseSettings({
        accounts: [
          { id: "default", apiKey: "", proxyId: null, proxy: null },
          { id: "worker-2", apiKey: "", proxyId: null, proxy: null },
        ],
      }),
      fetchImpl
    );

    // Intercept pick to record which account is used (mock only sees identical empty keys)
    const origPick = client.rotator.pick.bind(client.rotator);
    client.rotator.pick = (now?: number) => {
      const acct = origPick(now);
      callAccountIds.push(acct.id);
      return acct;
    };

    const result = await client.chatCompletions({
      body: { model: "big-pickle", messages: [{ role: "user", content: "x" }] },
      stream: false,
    });

    expect(result.status).toBe(200);
    expect(result.accountId).toBe("worker-2");
    expect(callN).toBe(2);
    expect(callAccountIds).toEqual(["default", "worker-2"]);
    // No Bearer on either attempt
    for (const [, init] of fetchImpl.mock.calls) {
      const h = (init as RequestInit | undefined)?.headers as Record<string, string> | undefined;
      expect(h?.Authorization).toBeUndefined();
    }
    // Exhausted worker is in cooldown
    expect(client.rotator.readyCount()).toBe(1);
    const cooled = client.rotator.getAccounts().find((a) => a.id === "default");
    expect(cooled?.cooldownUntil).toBeGreaterThan(Date.now());
  });
});

describe("UpstreamClient listModels", () => {
  it("GETs models URL", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe("https://opencode.ai/zen/v1/models");
      return jsonResponse(200, {
        object: "list",
        data: [{ id: "big-pickle", object: "model" }],
      });
    });
    const client = new UpstreamClient(baseSettings(), fetchImpl);
    const result = await client.listModels();
    expect(result.status).toBe(200);
    const text = await new Response(result.body).text();
    const parsed = JSON.parse(text);
    expect(parsed.object).toBe("list");
    expect(parsed.data[0].id).toBe("big-pickle");
  });
});
