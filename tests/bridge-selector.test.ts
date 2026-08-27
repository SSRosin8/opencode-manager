import { describe, expect, it } from "vitest";
import { selectAvailableBridge } from "../src/proxy/bridgeSelector.js";
import type { ClashBridgeProfile } from "../src/proxy/bridgeSelector.js";

const profile = (id: string): ClashBridgeProfile => ({
  id,
  name: id,
  enabled: true,
  apiBase: `http://127.0.0.1:${id === "zero" ? 9091 : 9090}`,
  apiSecret: "",
  localProxyHost: "127.0.0.1",
  localProxyPort: 7890,
  selectorGroup: "Proxy",
});

function fetchFor(routes: Record<string, Response | (() => Response | Promise<Response>)>) {
  return (async (input: string | URL | Request) => {
    const key = String(input);
    const route = routes[key];
    if (!route) throw new Error(`unexpected ${key}`);
    return typeof route === "function" ? route() : route;
  }) as typeof fetch;
}

describe("bridge selector", () => {
  it("selects the first healthy profile by priority and validates target node", async () => {
    const fetchImpl = fetchFor({
      "http://127.0.0.1:9091/version": new Response(JSON.stringify({ version: "0.1" }), { status: 200 }),
      "http://127.0.0.1:9091/proxies": new Response(JSON.stringify({ proxies: {
        Proxy: { type: "Selector", all: ["node-a"] },
      } }), { status: 200 }),
    });
    const result = await selectAvailableBridge([profile("zero"), { ...profile("disabled"), enabled: false }], "node-a", fetchImpl);
    expect(result.selected?.id).toBe("zero");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].ok).toBe(true);
  });

  it("keeps a controller when /version is unavailable but /proxies is valid", async () => {
    const fetchImpl = fetchFor({
      "http://127.0.0.1:9090/version": new Response("", { status: 404 }),
      "http://127.0.0.1:9090/proxies": new Response(JSON.stringify({ proxies: {
        Proxy: { type: "Selector", all: ["node-a"] },
      } }), { status: 200 }),
    });
    const result = await selectAvailableBridge([profile("clash")], "node-a", fetchImpl);
    expect(result.selected?.id).toBe("clash");
    expect(result.diagnostics[0].reason).toContain("ready via /proxies");
  });

  it("reports missing selector and target node instead of selecting", async () => {
    const fetchImpl = fetchFor({
      "http://127.0.0.1:9090/version": () => new Response(JSON.stringify({ version: "1" }), { status: 200 }),
      "http://127.0.0.1:9090/proxies": () => new Response(JSON.stringify({ proxies: {
        GLOBAL: { type: "Selector", all: ["node-a"] },
      } }), { status: 200 }),
    });
    const missingGroup = await selectAvailableBridge([profile("clash")], "node-a", fetchImpl);
    expect(missingGroup.selected).toBeNull();
    expect(missingGroup.diagnostics[0].reason).toContain("not found");

    const targetMissing = await selectAvailableBridge([{ ...profile("clash"), selectorGroup: "GLOBAL" }], "node-b", fetchImpl);
    expect(targetMissing.selected).toBeNull();
    expect(targetMissing.diagnostics[0].reason).toContain("not in selector group");
  });

  it("returns diagnostics when all candidates fail", async () => {
    const fetchImpl = fetchFor({
      "http://127.0.0.1:9090/version": new Response("", { status: 500 }),
      "http://127.0.0.1:9090/proxies": new Response("", { status: 503 }),
      "http://127.0.0.1:9091/version": () => { throw new Error("offline"); },
      "http://127.0.0.1:9091/proxies": () => { throw new Error("offline"); },
    });
    const result = await selectAvailableBridge([profile("clash"), profile("zero")], "node-a", fetchImpl);
    expect(result.selected).toBeNull();
    expect(result.diagnostics.map((entry) => entry.profileId)).toEqual(["clash", "zero"]);
  });

  it("orders candidates by priority and matches node names loosely", async () => {
    const fetchImpl = fetchFor({
      "http://127.0.0.1:9090/version": new Response(JSON.stringify({ version: "1" }), { status: 200 }),
      "http://127.0.0.1:9090/proxies": new Response(JSON.stringify({ proxies: {
        Proxy: { type: "Selector", all: [" node-a "] },
      } }), { status: 200 }),
      "http://127.0.0.1:9091/version": new Response(JSON.stringify({ version: "1" }), { status: 200 }),
      "http://127.0.0.1:9091/proxies": new Response(JSON.stringify({ proxies: {
        Proxy: { type: "Selector", all: ["node-a"] },
      } }), { status: 200 }),
    });
    const result = await selectAvailableBridge(
      [{ ...profile("zero"), priority: 10 }, { ...profile("clash"), priority: 1 }],
      " NODE-A ",
      fetchImpl,
    );
    expect(result.selected?.id).toBe("clash");
  });

  it("falls through when the controller is ready but its local proxy is unavailable", async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/version")) return new Response(JSON.stringify({ version: "1" }), { status: 200 });
      return new Response(JSON.stringify({ proxies: {
        Proxy: { type: "Selector", all: ["node-a"] },
      } }), { status: 200 });
    }) as typeof fetch;
    const result = await selectAvailableBridge(
      [profile("clash"), profile("zero")],
      "node-a",
      fetchImpl,
      100,
      async (candidate) => candidate.id === "clash"
        ? { ok: false, reason: "mixed-port refused connection" }
        : { ok: true },
    );
    expect(result.selected?.id).toBe("zero");
    expect(result.diagnostics[0]).toMatchObject({ ok: false, reason: "mixed-port refused connection" });
    expect(result.diagnostics[1].ok).toBe(true);
  });
});
