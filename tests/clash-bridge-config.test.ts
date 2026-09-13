import { describe, expect, it } from "vitest";
import { isValidProxyHost, normalizeClashBridge, normalizePoolProxy, proxyToUri } from "../src/proxy/pool.js";
import { applyClashHintsToBridge } from "../src/server/clashHints.js";
import { normalizeSettings } from "../src/settings/store.js";

describe("normalizeClashBridge", () => {
  it("migrates a legacy enabled bridge into a profile", () => {
    const result = normalizeClashBridge({
      enabled: true,
      apiBase: "http://127.0.0.1:9090/",
      apiSecret: "secret",
      localProxyHost: "127.0.0.1",
      localProxyPort: 7890,
      selectorGroup: "GLOBAL",
    });

    expect(result.selectionMode).toBe("auto");
    expect(result.bridges).toHaveLength(1);
    expect(result.bridges[0]).toMatchObject({
      id: "legacy-clash",
      priority: 0,
      apiBase: "http://127.0.0.1:9090",
      localProxyPort: 7890,
    });
  });

  it("keeps valid profiles and selects a known active bridge", () => {
    const result = normalizeClashBridge({
      selectionMode: "manual",
      activeBridgeId: "mihomo",
      bridges: [
        {
          id: "clash",
          name: "Clash",
          priority: 4.8,
          apiBase: "http://127.0.0.1:9090/",
          localProxyPort: "7890",
        },
        { id: "mihomo", name: "Mihomo", apiBase: "http://127.0.0.1:9091", localProxyPort: 7891 },
        { id: "invalid", apiBase: "", localProxyPort: 0 },
      ],
    });

    expect(result.selectionMode).toBe("manual");
    expect(result.bridges).toHaveLength(2);
    expect(result.bridges[0].apiBase).toBe("http://127.0.0.1:9090");
    expect(result.bridges[0].localProxyPort).toBe(7890);
    expect(result.bridges[0].priority).toBe(4);
    expect(result.activeBridgeId).toBe("mihomo");
  });

  it("clears an active bridge that is not configured", () => {
    const result = normalizeClashBridge({
      activeBridgeId: "missing",
      bridges: [{ id: "clash", apiBase: "http://127.0.0.1:9090", localProxyPort: 7890 }],
    });

    expect(result.activeBridgeId).toBeNull();
  });

  it("migrates a disabled legacy bridge while normalizing persisted settings", () => {
    const result = normalizeSettings({
      clashBridge: {
        enabled: false,
        apiBase: "http://127.0.0.1:9099",
        apiSecret: "",
        localProxyHost: "127.0.0.1",
        localProxyPort: 7999,
        selectorGroup: "Proxy",
      },
    });

    expect(result.clashBridge.bridges).toEqual([
      {
        id: "legacy-clash",
        name: "Clash bridge",
        enabled: false,
        priority: 0,
        apiBase: "http://127.0.0.1:9099",
        apiSecret: "",
        localProxyHost: "127.0.0.1",
        localProxyPort: 7999,
        selectorGroup: "Proxy",
      },
    ]);
  });

  it("preserves an explicitly empty profile list after deleting all cores", () => {
    const result = normalizeClashBridge({
      enabled: true,
      apiBase: "http://127.0.0.1:9090",
      localProxyPort: 7890,
      bridges: [],
      activeBridgeId: "legacy-clash",
    });
    expect(result.bridges).toEqual([]);
    expect(result.activeBridgeId).toBeNull();
  });
});

describe("proxy input normalization", () => {
  it("rejects authority-breaking hosts and preserves IPv6 proxy URIs", () => {
    expect(isValidProxyHost("proxy.example.test")).toBe(true);
    expect(isValidProxyHost("user@proxy.example.test")).toBe(false);
    expect(normalizePoolProxy({ host: "proxy.example.test", port: 80.5 })).toBeNull();
    expect(proxyToUri({ type: "http", host: "2001:db8::1", port: 8080 })).toBe(
      "http://[2001:db8::1]:8080"
    );
  });

  it("does not let a subscription redirect bridge hints to a remote controller", () => {
    const current = normalizeClashBridge({ enabled: false });
    const next = applyClashHintsToBridge(current, {
      externalController: "https://attacker.example/controller",
      mixedPort: 7892,
    });
    expect(next.apiBase).toBe(current.apiBase);
    expect(next.localProxyPort).toBe(7892);
  });
});
