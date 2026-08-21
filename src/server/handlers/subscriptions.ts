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
    const saved = await store.update((current) => ({
      proxySubscriptions: [...current.proxySubscriptions, sub],
    }));
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
    const saved = await store.update((current) => {
      const removedIds = new Set(
        current.proxyPool
          .filter((p) => p.source === "subscription" && p.subscriptionId === id)
          .map((p) => p.id)
      );
      return {
        proxyPool: current.proxyPool.filter(
          (p) => !(p.source === "subscription" && p.subscriptionId === id)
        ),
        proxySubscriptions: current.proxySubscriptions.filter((x) => x.id !== id),
        accounts: current.accounts.map((a) =>
          a.proxyId && removedIds.has(a.proxyId) ? { ...a, proxyId: null } : a
        ),
      };
    });
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
      let updatedSub: ProxySubscription | null = null;
      const saved = await store.update((current) => {
        const latestSub = current.proxySubscriptions.find((x) => x.id === id);
        if (!latestSub) throw new Error("subscription_removed_during_fetch");
        updatedSub = {
          ...latestSub,
          lastFetchedAt: new Date().toISOString(),
          lastError:
            result.proxies.length === 0
              ? "Parsed 0 nodes — check URL or try again"
              : null,
          lastImportCount: result.proxies.length,
          lastRawBytes: result.rawBytes,
          lastDirectCount: result.usableCount,
          lastBridgeableCount: result.bridgeableCount,
          lastFormat: result.format,
          lastUserAgent: result.usedUserAgent,
        };
        return {
          proxyPool: mergeSubscriptionProxies(current.proxyPool, id, result.proxies),
          proxySubscriptions: current.proxySubscriptions.map((x) =>
            x.id === id ? updatedSub! : x
          ),
          // Auto-fill bridge endpoints from hints without overwriting concurrent edits.
          clashBridge: applyClashHintsToBridge(current.clashBridge, result.clashHints),
        };
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
      if (message === "subscription_removed_during_fetch") {
        sendJson(res, 404, { error: { message: `Subscription not found: ${id}` } });
        return true;
      }
      let updatedSub: ProxySubscription | null = null;
      await store.update((current) => {
        const latestSub = current.proxySubscriptions.find((x) => x.id === id);
        if (!latestSub) return {};
        updatedSub = {
          ...latestSub,
          lastFetchedAt: new Date().toISOString(),
          lastError: message,
        };
        return {
          proxySubscriptions: current.proxySubscriptions.map((x) =>
            x.id === id ? updatedSub! : x
          ),
        };
      });
      if (!updatedSub) {
        sendJson(res, 404, { error: { message: `Subscription not found: ${id}` } });
        return true;
      }
      sendJson(res, 502, {
        error: { message: `Subscription fetch failed: ${message}` },
        subscription: updatedSub,
      });
    }
    return true;
  }


  return false;
}
