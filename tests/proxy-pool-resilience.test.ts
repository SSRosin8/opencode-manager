import { describe, expect, it, vi } from "vitest";
import { fetchClashSubscription } from "../src/proxy/clash.js";
import { newProxyId, normalizeProxyPool } from "../src/proxy/pool.js";
import { UpstreamClient } from "../src/proxy/upstream.js";
import type { GatewaySettings } from "../src/settings/store.js";

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
    routingStrategy: "anonymous_first",
    relayAccessToken: "",
    port: 9876,
    ...over,
  };
}

describe("normalizeProxyPool", () => {
  it("drops invalid entries", () => {
    const pool = normalizeProxyPool([
      { id: "ok", host: "1.1.1.1", port: 80, type: "http" },
      { host: "", port: 1 },
      null,
    ]);
    expect(pool).toHaveLength(1);
    expect(pool[0].host).toBe("1.1.1.1");
    expect(newProxyId().startsWith("px_")).toBe(true);
  });
});

describe("listModels resilience", () => {
  it("fails closed when a bound Clash switch fails", async () => {
    const bridgeFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ message: "Resource not found" }), {
        status: 404,
      });
    });
    const upstreamFetch = vi.fn(async (url: string, init?: RequestInit) => {
      // direct (no dispatcher) path
      if (String(url).includes("/models") && !(init as { dispatcher?: unknown })?.dispatcher) {
        return new Response(
          JSON.stringify({
            object: "list",
            data: [{ id: "big-pickle", object: "model" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      throw new Error("should not use proxy path successfully");
    });

    const client = new UpstreamClient(
      settings({
        clashBridge: {
          enabled: true,
          apiBase: "http://127.0.0.1:9090",
          apiSecret: "",
          localProxyHost: "127.0.0.1",
          localProxyPort: 7892,
          selectorGroup: "主代理",
        },
        proxyPool: [
          {
            id: "px_jp",
            name: "JP-2",
            type: "vless",
            host: "jp.example.com",
            port: 1,
            enabled: true,
            source: "subscription",
            usable: false,
            bridgeable: true,
            clashNodeName: "JP-2",
          },
        ],
        accounts: [{ id: "w1", apiKey: "", proxyId: "px_jp", proxy: null }],
      }),
      upstreamFetch as unknown as import("../src/proxy/upstream.js").ProxyFetch,
      bridgeFetch as unknown as typeof fetch
    );

    await expect(client.listModels()).rejects.toThrow("Clash switch failed");
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});

describe("fetchClashSubscription multi-UA", () => {
  it("prefers clash UA YAML over base64 vless list", async () => {
    const yaml = `
mixed-port: 7892
proxies:
  - name: N1
    type: vless
    server: a.example.com
    port: 1
  - name: N2
    type: vless
    server: b.example.com
    port: 2
proxy-groups:
  - name: 主代理
    type: select
    proxies: [N1, N2]
`;
    const b64 = Buffer.from(
      "vless://u@a.example.com:1#OnlyOne\n",
      "utf8"
    ).toString("base64");

    const fetchImpl = async (_url: string, init?: RequestInit) => {
      const ua = String((init?.headers as Record<string, string>)?.["User-Agent"] || "");
      if (ua === "clash") return new Response(yaml, { status: 200 });
      return new Response(b64, { status: 200 });
    };

    const result = await fetchClashSubscription({
      url: "https://example.com/sub",
      subscriptionId: "s1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.format).toBe("clash-yaml");
    expect(result.proxies.length).toBe(2);
    expect(result.usedUserAgent).toBe("clash");
    expect(result.clashHints?.mixedPort).toBe(7892);
  });
});
