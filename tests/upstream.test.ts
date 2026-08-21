/**
 * Upstream client tests with mock fetch at network boundary.
 */
import { describe, expect, it, vi } from "vitest";
import {
  parseRetryAfterMs,
  UpstreamClient,
  type UpstreamAttemptEvent,
} from "../src/proxy/upstream.js";
import type { GatewaySettings } from "../src/settings/store.js";
import { transformRequestBody } from "../src/relay/index.js";

function baseSettings(over: Partial<GatewaySettings> = {}): GatewaySettings {
  return {
    baseUrl: "https://opencode.ai/zen/v1",
    relayAccessToken: "",
    synthesizeCliHeaders: false,
    cliUserAgent: "opencode-cli/1.0.0",
    cliClient: "cli",
    cliProject: "default",
    routingStrategy: "anonymous_first",
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
  it("sends Bearer public for an anonymous Zen worker", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer public");
      return jsonResponse(200, { choices: [] });
    });
    const client = new UpstreamClient(
      baseSettings({
        accounts: [{ id: "anon", apiKey: "", kind: "anonymous_zen", proxy: null }],
      }),
      fetchImpl
    );

    await client.chatCompletions({ body: { model: "big-pickle" }, stream: false });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("uses a one-token payload for manual Worker connection tests", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        messages: [{ role: "user", content: "x" }],
        max_tokens: 1,
        stream: false,
      });
      return jsonResponse(200, { choices: [] });
    });
    const client = new UpstreamClient(
      baseSettings({
        accounts: [{ id: "manual-test", apiKey: "key", kind: "authenticated_zen" }],
      }),
      fetchImpl
    );

    const result = await client.testAccountConnection("manual-test", "big-pickle");

    expect(result.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("honors routing strategy and skips disabled workers", async () => {
    const authHeaders: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      authHeaders.push((init?.headers as Record<string, string>).Authorization);
      return jsonResponse(200, { choices: [] });
    });
    const client = new UpstreamClient(
      baseSettings({
        routingStrategy: "authenticated_first",
        accounts: [
          { id: "anon", apiKey: "", kind: "anonymous_zen" },
          { id: "disabled-login", apiKey: "disabled", enabled: false },
          { id: "login", apiKey: "enabled", kind: "authenticated_zen" },
        ],
      }),
      fetchImpl
    );

    const result = await client.chatCompletions({
      body: { model: "big-pickle" },
      stream: false,
    });

    expect(result.accountId).toBe("login");
    expect(authHeaders).toEqual(["Bearer enabled"]);
  });

  it("exhausts anonymous workers before falling back to signed-in Zen", async () => {
    const events: UpstreamAttemptEvent[] = [];
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error("anonymous route unavailable");
      if (calls === 2) return jsonResponse(429, { error: { message: "quota used" } });
      return jsonResponse(200, { choices: [] });
    });
    const client = new UpstreamClient(
      baseSettings({
        routingStrategy: "anonymous_first",
        accounts: [
          { id: "login", apiKey: "signed-in", kind: "authenticated_zen" },
          { id: "anon-a", apiKey: "", kind: "anonymous_zen" },
          { id: "anon-b", apiKey: "", kind: "anonymous_zen" },
        ],
      }),
      fetchImpl
    );
    client.setAttemptObserver((event) => events.push(event));

    const result = await client.chatCompletions({
      body: { model: "big-pickle" },
      stream: false,
      sessionKey: "fallback",
    });

    expect(result.accountId).toBe("login");
    expect(events.map((event) => event.accountId)).toEqual([
      "anon-a",
      "anon-b",
      "login",
    ]);
  });

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

  it("never silently bypasses an invalid inline proxy", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { choices: [] }));
    const client = new UpstreamClient(
      baseSettings({
        accounts: [{
          id: "invalid-proxy",
          apiKey: "secret",
          proxyId: null,
          proxy: { type: "http", host: "", port: 8080 },
        }],
      }),
      fetchImpl
    );

    await expect(client.chatCompletions({
      body: { model: "big-pickle" },
      stream: false,
    })).rejects.toThrow("Invalid proxy configuration");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses only an intentionally unbound worker for direct fallback", async () => {
    const authHeaders: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get("authorization") || "";
      authHeaders.push(auth);
      if ((init as RequestInit & { dispatcher?: unknown })?.dispatcher) {
        throw new Error("bound route failed");
      }
      return jsonResponse(200, { choices: [] });
    });
    const client = new UpstreamClient(
      baseSettings({
        routingStrategy: "mixed",
        proxyPool: [{
          id: "bound-proxy", name: "bound", type: "http", host: "127.0.0.1", port: 8080,
          enabled: true, source: "manual", usable: true,
        }],
        accounts: [
          { id: "bound", apiKey: "bound-key", kind: "authenticated_zen", proxyId: "bound-proxy" },
          { id: "unbound", apiKey: "unbound-key", kind: "authenticated_zen", proxyId: null },
        ],
      }),
      fetchImpl
    );

    const result = await client.chatCompletions({ body: { model: "big-pickle" }, stream: false });
    expect(result.accountId).toBe("unbound");
    expect(authHeaders.at(-1)).toBe("Bearer unbound-key");
  });

  it("rotates to next key on 429", async () => {
    const authHeaders: string[] = [];
    const events: UpstreamAttemptEvent[] = [];
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
    client.setAttemptObserver((event) => events.push(event));
    const result = await client.chatCompletions({
      body: { model: "hy3-free", messages: [{ role: "user", content: "x" }] },
      stream: false,
    });

    expect(result.status).toBe(200);
    expect(authHeaders.length).toBeGreaterThanOrEqual(2);
    expect(new Set(authHeaders).size).toBeGreaterThanOrEqual(2);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      operation: "chat",
      status: 429,
      outcome: "rate_limited",
      attempt: 1,
      willRetry: true,
    });
    expect(events[1]).toMatchObject({
      operation: "chat",
      status: 200,
      outcome: "success",
      attempt: 2,
      willRetry: false,
    });
    expect(events[1].requestId).toBe(events[0].requestId);
    expect(events[1].accountId).not.toBe(events[0].accountId);
  });

  it("cancels a retryable response body before trying the next worker", async () => {
    const cancel = vi.fn();
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1]));
          },
          cancel,
        });
        return new Response(body, { status: 429 });
      }
      return jsonResponse(200, { choices: [] });
    });
    const client = new UpstreamClient(baseSettings(), fetchImpl);

    const result = await client.chatCompletions({
      body: { model: "big-pickle" },
      stream: false,
    });

    expect(result.status).toBe(200);
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403, 429, 500])(
    "returns the final HTTP %i response body after all workers are exhausted",
    async (status) => {
      const events: UpstreamAttemptEvent[] = [];
      const fetchImpl = vi.fn(async () =>
        jsonResponse(status, { error: { message: `final-${status}` } })
      );
      const client = new UpstreamClient(baseSettings(), fetchImpl);
      client.setAttemptObserver((event) => events.push(event));

      const result = await client.chatCompletions({
        body: { model: "big-pickle" },
        stream: false,
      });

      expect(result.status).toBe(status);
      expect(await new Response(result.body).json()).toEqual({
        error: { message: `final-${status}` },
      });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(events).toHaveLength(2);
      expect(events.at(-1)?.willRetry).toBe(false);
      expect(events.every((event) => event.maxAttempts === 2)).toBe(true);
    }
  );

  it("does not retry an unbound worker after the normal attempt loop", async () => {
    const events: UpstreamAttemptEvent[] = [];
    const fetchImpl = vi.fn(async () => {
      throw new Error("direct route failed");
    });
    const client = new UpstreamClient(
      baseSettings({
        accounts: [{ id: "direct", apiKey: "key", proxyId: null, proxy: null }],
      }),
      fetchImpl
    );
    client.setAttemptObserver((event) => events.push(event));

    await expect(client.chatCompletions({
      body: { model: "big-pickle" },
      stream: false,
    })).rejects.toThrow("direct route failed");

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ attempt: 1, maxAttempts: 1, willRetry: false });
  });

  it("observes a transport failure and the successful retry as one request", async () => {
    const events: UpstreamAttemptEvent[] = [];
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error("connect ECONNREFUSED key-one");
      return jsonResponse(200, { choices: [] });
    });
    const client = new UpstreamClient(baseSettings(), fetchImpl);
    client.setAttemptObserver((event) => events.push(event));

    const result = await client.chatCompletions({
      body: { model: "big-pickle" },
      stream: false,
    });

    expect(result.status).toBe(200);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      status: null,
      outcome: "transport_error",
      error: "connect ECONNREFUSED [REDACTED]",
      willRetry: true,
    });
    expect(events[1]).toMatchObject({ status: 200, outcome: "success" });
    expect(events[1].requestId).toBe(events[0].requestId);
    expect(events[1].accountId).not.toBe(events[0].accountId);
  });

  it.each([401, 403, 500])("rotates away from an unusable worker on HTTP %i", async (status) => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      return calls === 1
        ? jsonResponse(status, { error: { message: "unusable worker" } })
        : jsonResponse(200, { choices: [] });
    });
    const client = new UpstreamClient(baseSettings(), fetchImpl);

    const result = await client.chatCompletions({
      body: { model: "big-pickle" },
      stream: false,
      sessionKey: "fallback-session",
    });

    expect(result.status).toBe(200);
    expect(calls).toBe(2);
    expect(client.rotator.readyCount()).toBe(1);
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

  it("keeps separate worker affinity for separate OpenCode sessions", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { choices: [] }));
    const client = new UpstreamClient(baseSettings(), fetchImpl);

    const first = await client.chatCompletions({
      body: { model: "big-pickle" },
      stream: false,
      clientHeaders: { "x-session-id": "session-a" },
    });
    const second = await client.chatCompletions({
      body: { model: "big-pickle" },
      stream: false,
      clientHeaders: { "x-session-id": "session-b" },
    });
    const again = await client.chatCompletions({
      body: { model: "big-pickle" },
      stream: false,
      clientHeaders: { "x-session-id": "session-a" },
    });

    expect(first.accountId).not.toBe(second.accountId);
    expect(again.accountId).toBe(first.accountId);
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
    // OpenCode anonymous mode uses the public placeholder credential.
    for (const [, init] of fetchImpl.mock.calls) {
      const h = (init as RequestInit | undefined)?.headers as Record<string, string> | undefined;
      expect(h?.Authorization).toBe("Bearer public");
    }
    // Exhausted worker is in cooldown
    expect(client.rotator.readyCount()).toBe(1);
    const cooled = client.rotator.getAccounts().find((a) => a.id === "default");
    expect(cooled?.cooldownUntil).toBeGreaterThan(Date.now());
  });
});

describe("Retry-After parsing", () => {
  it("supports delta seconds and HTTP dates", () => {
    expect(parseRetryAfterMs("12", 1_000)).toBe(12_000);
    expect(parseRetryAfterMs("Thu, 01 Jan 1970 00:00:10 GMT", 1_000)).toBe(9_000);
    expect(parseRetryAfterMs("invalid", 1_000)).toBeUndefined();
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
