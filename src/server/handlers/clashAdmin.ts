import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestContext } from "../context.js";
import { importClashControllerNodes, probeClashBridge } from "../../proxy/clashBridge.js";
import { mergeControllerProxies } from "../../proxy/pool.js";
import type { GatewaySettings } from "../../settings/store.js";
import { readBody, sendJson } from "../httpIO.js";

export async function handleClashAdmin(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: RequestContext
): Promise<boolean> {
  const { store, upstream, subscriptionFetch } = ctx;
  // POST /admin/api/clash-bridge/probe
  if (method === "POST" && path === "/admin/api/clash-bridge/probe") {
    const s = store.get();
    const raw = await readBody(req);
    let override: Partial<GatewaySettings["clashBridge"]> = {};
    if (raw.length) {
      try {
        override = JSON.parse(raw.toString("utf8") || "{}") as Partial<
          GatewaySettings["clashBridge"]
        >;
      } catch {
        /* ignore */
      }
    }
    const bridge = { ...s.clashBridge, ...override };
    const result = await probeClashBridge(bridge, subscriptionFetch ?? globalThis.fetch);
    sendJson(res, result.ok ? 200 : 502, { ...result, bridge });
    return true;
  }

  // POST /admin/api/clash-bridge/import
  // Save the submitted bridge config and import nodes already loaded by Mihomo/Clash.
  if (method === "POST" && path === "/admin/api/clash-bridge/import") {
    const s = store.get();
    const raw = await readBody(req);
    let override: Partial<GatewaySettings["clashBridge"]> = {};
    if (raw.length) {
      try {
        override = JSON.parse(raw.toString("utf8") || "{}") as Partial<
          GatewaySettings["clashBridge"]
        >;
      } catch {
        sendJson(res, 400, { error: { message: "invalid JSON body" } });
        return true;
      }
    }
    const bridge = { ...s.clashBridge, ...override };
    try {
      const result = await importClashControllerNodes(
        bridge,
        subscriptionFetch ?? globalThis.fetch
      );
      const proxyPool = mergeControllerProxies(
        s.proxyPool,
        result.group,
        result.proxies
      );
      const liveIds = new Set(proxyPool.map((p) => p.id));
      const accounts = s.accounts.map((account) =>
        account.proxyId && !liveIds.has(account.proxyId)
          ? { ...account, proxyId: null }
          : account
      );
      const saved = await store.save({
        clashBridge: bridge,
        proxyPool,
        accounts,
      });
      upstream.updateSettings(saved);
      store.updateReadyCount(
        upstream.rotator.readyCount(),
        upstream.rotator.getAccounts().length
      );
      sendJson(res, 200, {
        imported: result.proxies.length,
        group: result.group,
        current: result.current,
        groups: result.groups,
        settings: saved,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 502, { error: { message: `Controller import failed: ${message}` } });
    }
    return true;
  }


  return false;
}
