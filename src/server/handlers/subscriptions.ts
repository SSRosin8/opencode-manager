import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestContext } from "../context.js";
import { fetchClashSubscription } from "../../proxy/clash.js";
import { mergeSubscriptionProxies, newProxyId, type ProxySubscription } from "../../proxy/pool.js";
import { applyClashHintsToBridge } from "../clashHints.js";
import { readBody, sendJson } from "../httpIO.js";

export async function handleSubscriptions(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: RequestContext
): Promise<boolean> {
  const { store, upstream, subscriptionFetch } = ctx;
  // POST /admin/api/proxy-subscriptions — add subscription (does not fetch yet)
  if (method === "POST" && path === "/admin/api/proxy-subscriptions") {
    const raw = await readBody(req);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw.toString("utf8") || "{}") as Record<string, unknown>;
    } catch {
      sendJson(res, 400, { error: { message: "Invalid JSON" } });
      return true;
    }
    const subUrl = typeof body.url === "string" ? body.url.trim() : "";
    if (!subUrl) {
      sendJson(res, 400, { error: { message: "url required" } });
      return true;
    }
    const s = store.get();
    const sub: ProxySubscription = {
      id: newProxyId("sub"),
      name:
        typeof body.name === "string" && body.name.trim()
          ? body.name.trim()
          : `sub-${s.proxySubscriptions.length + 1}`,
      url: subUrl,
      enabled: body.enabled !== false,
      lastFetchedAt: null,
      lastError: null,
      lastImportCount: 0,
    };
    const saved = await store.save({
      proxySubscriptions: [...s.proxySubscriptions, sub],
    });
    sendJson(res, 200, { subscription: sub, settings: saved });
    return true;
  }

  // DELETE /admin/api/proxy-subscriptions/:id
  if (method === "DELETE" && path.startsWith("/admin/api/proxy-subscriptions/")) {
    const id = decodeURIComponent(path.slice("/admin/api/proxy-subscriptions/".length));
    if (!id || id.includes("/")) {
      sendJson(res, 400, { error: { message: "Missing subscription id" } });
      return true;
    }
    const s = store.get();
    const proxyPool = s.proxyPool.filter(
      (p) => !(p.source === "subscription" && p.subscriptionId === id)
    );
    const proxySubscriptions = s.proxySubscriptions.filter((x) => x.id !== id);
    // clear account bindings that pointed at removed proxies
    const removedIds = new Set(
      s.proxyPool
        .filter((p) => p.source === "subscription" && p.subscriptionId === id)
        .map((p) => p.id)
    );
    const accounts = s.accounts.map((a) =>
      a.proxyId && removedIds.has(a.proxyId) ? { ...a, proxyId: null } : a
    );
    const saved = await store.save({ proxyPool, proxySubscriptions, accounts });
    upstream.updateSettings(saved);
    store.updateReadyCount(
      upstream.rotator.readyCount(),
      upstream.rotator.getAccounts().length
    );
    sendJson(res, 200, saved);
    return true;
  }

  // POST /admin/api/proxy-subscriptions/:id/fetch — pull Clash sub into pool
  if (method === "POST" && path.match(/^\/admin\/api\/proxy-subscriptions\/[^/]+\/fetch$/)) {
    const id = decodeURIComponent(
      path.slice("/admin/api/proxy-subscriptions/".length, -"/fetch".length)
    );
    const s = store.get();
    const sub = s.proxySubscriptions.find((x) => x.id === id);
    if (!sub) {
      sendJson(res, 404, { error: { message: `Subscription not found: ${id}` } });
      return true;
    }

    try {
      const result = await fetchClashSubscription({
        url: sub.url,
        subscriptionId: sub.id,
        fetchImpl: subscriptionFetch,
      });
      const mergedPool = mergeSubscriptionProxies(s.proxyPool, sub.id, result.proxies);
      const updatedSub: ProxySubscription = {
        ...sub,
        lastFetchedAt: new Date().toISOString(),
        lastError:
          result.proxies.length === 0
            ? "Parsed 0 nodes — check URL or try again"
            : null,
        lastImportCount: result.proxies.length,
        lastDirectCount: result.usableCount,
        lastBridgeableCount: result.bridgeableCount,
        lastFormat: result.format,
        lastUserAgent: result.usedUserAgent,
      };
      const proxySubscriptions = s.proxySubscriptions.map((x) =>
        x.id === id ? updatedSub : x
      );
      // Auto-fill Clash bridge endpoints from subscription YAML (mitce: 7892 / 主代理)
      const clashBridge = applyClashHintsToBridge(s.clashBridge, result.clashHints);
      const saved = await store.save({
        proxyPool: mergedPool,
        proxySubscriptions,
        clashBridge,
      });
      upstream.updateSettings(saved);
      store.updateReadyCount(
        upstream.rotator.readyCount(),
        upstream.rotator.getAccounts().length
      );
      sendJson(res, 200, {
        ok: true,
        format: result.format,
        usableCount: result.usableCount,
        bridgeableCount: result.bridgeableCount,
        skippedCount: result.skippedCount,
        totalCount: result.proxies.length,
        rawBytes: result.rawBytes,
        usedUserAgent: result.usedUserAgent,
        clashHints: result.clashHints,
        hint:
          result.usableCount === 0 && result.bridgeableCount > 0
            ? "订阅节点均为 vless/hysteria2/tuic 等协议，需开启「Clash 桥接」并运行本地 Mihomo/Clash 后才能作为出口。"
            : result.proxies.length === 0
              ? "未解析到节点。"
              : undefined,
        subscription: updatedSub,
        settings: saved,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const updatedSub: ProxySubscription = {
        ...sub,
        lastFetchedAt: new Date().toISOString(),
        lastError: message,
      };
      const proxySubscriptions = s.proxySubscriptions.map((x) =>
        x.id === id ? updatedSub : x
      );
      await store.save({ proxySubscriptions });
      sendJson(res, 502, {
        error: { message: `Subscription fetch failed: ${message}` },
        subscription: updatedSub,
      });
    }
    return true;
  }


  return false;
}
