import { describe, expect, it, vi } from "vitest";
import { bridgeProfiles, resolveBridge } from "../src/proxy/bridgeRuntime.js";
import type { ClashBridgeConfig, ClashBridgeProfile } from "../src/proxy/pool.js";

function profile(id: string, port: number): ClashBridgeProfile {
  return {
    id,
    name: id,
    enabled: true,
    priority: 0,
    apiBase: `http://127.0.0.1:${port + 1000}`,
    apiSecret: "",
    localProxyHost: "127.0.0.1",
    localProxyPort: port,
    selectorGroup: "Proxy",
  };
}

function config(overrides: Partial<ClashBridgeConfig> = {}): ClashBridgeConfig {
  return {
    enabled: true,
    apiBase: "http://127.0.0.1:9090",
    apiSecret: "legacy-secret",
    localProxyHost: "127.0.0.1",
    localProxyPort: 7890,
    selectorGroup: "GLOBAL",
    selectionMode: "auto",
    bridges: [],
    activeBridgeId: null,
    ...overrides,
  };
}

function controllerFetch(statusByPort: Record<number, number>, calls: string[]) {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(`${url.port}${url.pathname}`);
    const status = statusByPort[Number(url.port)] ?? 500;
    if (url.pathname === "/version") {
      return new Response(JSON.stringify({ version: "1.0" }), { status });
    }
    return new Response(JSON.stringify({
      proxies: { Proxy: { type: "Selector", all: ["target-node"] } },
    }), { status });
  }) as typeof fetch;
}

describe("bridge runtime", () => {
  it("exposes the legacy single-bridge fields as one profile", () => {
    const profiles = bridgeProfiles(config());
    expect(profiles[0].id).toBe("legacy-clash");
  });

  it("tries the active profile first in auto mode and fails over", async () => {
    const standby = profile("standby", 7001);
    const active = profile("active", 7002);
    const calls: string[] = [];
    const result = await resolveBridge(
      config({ bridges: [standby, active], activeBridgeId: active.id }),
      "target-node",
      controllerFetch({ 8002: 503, 8001: 200 }, calls),
    );

    expect(result.profile?.id).toBe("standby");
    expect(result.bridge).toMatchObject({
      enabled: true,
      activeBridgeId: "standby",
      apiBase: standby.apiBase,
      localProxyPort: standby.localProxyPort,
    });
    expect(result.diagnostics.map((item) => item.profileId)).toEqual(["active", "standby"]);
    expect(calls).toEqual([
      "8002/version", "8002/proxies",
      "8001/version", "8001/proxies",
    ]);
  });

  it("uses only the active profile in manual mode without probing", async () => {
    const first = profile("first", 7001);
    const active = profile("active", 7002);
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await resolveBridge(
      config({ selectionMode: "manual", bridges: [first, active], activeBridgeId: active.id }),
      "target-node",
      fetchImpl,
    );

    expect(result.profile?.id).toBe("active");
    expect(result.bridge.localProxyPort).toBe(7002);
    expect(result.diagnostics).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("disables bridging when auto mode has no healthy candidate", async () => {
    const first = profile("first", 7001);
    const second = profile("second", 7002);
    const result = await resolveBridge(
      config({ bridges: [first, second], activeBridgeId: first.id }),
      "target-node",
      controllerFetch({ 8001: 503, 8002: 401 }, []),
    );

    expect(result.profile).toBeNull();
    expect(result.bridge.enabled).toBe(false);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics.every((item) => !item.ok)).toBe(true);
  });
});
