import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestContext } from "../context.js";
import { fetchClashSubscription } from "../../proxy/clash.js";
import { mergeSubscriptionProxies } from "../../proxy/pool.js";
import { applyClashHintsToBridge } from "../clashHints.js";
import { sendJson } from "../httpIO.js";

function redactedSubscriptionUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname || "/"}`;
  } catch {
    return "[invalid url]";
  }
}

export async function handleSubscriptionRefresh(
  _req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: RequestContext
): Promise<boolean> {
  const { store, upstream, subscriptionFetch } = ctx;
  // POST /admin/api/proxy-subscriptions/fetch-all
  if (method === "POST" && path === "/admin/api/proxy-subscriptions/fetch-all") {
    const s = store.get();
    let pool = s.proxyPool;
    const subs = [...s.proxySubscriptions];
    const results: Array<Record<string, unknown>> = [];

    for (let i = 0; i < subs.length; i++) {
      const sub = subs[i];
      if (!sub.enabled) {
        results.push({ id: sub.id, skipped: true, reason: "disabled" });
        continue;
      }
      try {
        const result = await fetchClashSubscription({
          url: sub.url,
          subscriptionId: sub.id,
          fetchImpl: subscriptionFetch,
        });
        if (!result.proxies.length) {
          // Transient empty parse must not wipe a healthy pool.
          subs[i] = {
            ...sub,
            lastFetchedAt: new Date().toISOString(),
            lastError: "Parsed 0 nodes — kept existing pool, check URL or try again",
            lastImportCount: 0,
          };
          results.push({ id: sub.id, ok: false, error: subs[i].lastError });
          continue;
        }
        pool = mergeSubscriptionProxies(pool, sub.id, result.proxies);
        subs[i] = {
          ...sub,
          lastFetchedAt: new Date().toISOString(),
          lastError: null,
          lastImportCount: result.proxies.length,
          lastRawBytes: result.rawBytes,
          lastDirectCount: result.usableCount,
          lastBridgeableCount: result.bridgeableCount,
          lastFormat: result.format,
          lastUserAgent: result.usedUserAgent,
        };
        // apply hints from last successful YAML
        if (result.clashHints) {
          /* applied after loop on last hints — see below */
        }
        results.push({
          id: sub.id,
          ok: true,
          totalCount: result.proxies.length,
          usableCount: result.usableCount,
          bridgeableCount: result.bridgeableCount,
          skippedCount: result.skippedCount,
          rawBytes: result.rawBytes,
          format: result.format,
          usedUserAgent: result.usedUserAgent,
          clashHints: result.clashHints,
        });
      } catch (err) {
        const rawMessage = err instanceof Error ? err.message : String(err);
        const message = rawMessage.replace(sub.url, redactedSubscriptionUrl(sub.url)).slice(0, 500);
        subs[i] = {
          ...sub,
          lastFetchedAt: new Date().toISOString(),
          lastError: message,
        };
        results.push({ id: sub.id, ok: false, error: message });
      }
    }

    const lastHints = [...results]
      .reverse()
      .find((r) => r.ok && r.clashHints)?.clashHints as
      | Parameters<typeof applyClashHintsToBridge>[1]
      | undefined;
    const clashBridge = applyClashHintsToBridge(s.clashBridge, lastHints);

    const liveIds = new Set(pool.map((proxy) => proxy.id));
    const saved = await store.save({
      proxyPool: pool,
      proxySubscriptions: subs,
      clashBridge,
      accounts: s.accounts.map((account) =>
        account.proxyId && !liveIds.has(account.proxyId)
          ? { ...account, proxyId: null }
          : account
      ),
    });
    upstream.updateSettings(saved);
    store.updateReadyCount(
      upstream.rotator.readyCount(),
      upstream.rotator.getAccounts().length
    );
    sendJson(res, 200, { results, settings: saved });
    return true;
  }



  return false;
}
