import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestContext } from "../context.js";
import { probeAnonymousZenProxy, probePoolProxy, type ProbeResult } from "../../proxy/probe.js";
import { applyProbeEgressIps } from "../../proxy/pool.js";
import { attachAnonymousZenResult, syncAnonymousWorkers } from "../workerEgress.js";
import { readBody, sendJson } from "../httpIO.js";

export async function handleProxyPool(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: RequestContext
): Promise<boolean> {
  const { store, upstream, subscriptionFetch, probes, clashProbeQueue, freeModels } = ctx;
  // POST /admin/api/proxy-pool/:id/test — single node latency probe
  if (method === "POST" && path.match(/^\/admin\/api\/proxy-pool\/[^/]+\/test$/)) {
    const id = decodeURIComponent(
      path.slice("/admin/api/proxy-pool/".length, -"/test".length)
    );
    const s = store.get();
    const proxy = s.proxyPool.find((p) => p.id === id);
    if (!proxy) {
      sendJson(res, 404, { error: { message: `Proxy not found: ${id}` } });
      return true;
    }
    const networkProbe: ProbeResult = await probePoolProxy(proxy, s.clashBridge, {
      fetchImpl: ctx?.probeFetch,
      bridgeFetch: subscriptionFetch ?? globalThis.fetch,
      clashQueue: clashProbeQueue,
    });
    const result = networkProbe.ok
      ? attachAnonymousZenResult(
          networkProbe,
          await probeAnonymousZenProxy(proxy, s.clashBridge, {
            baseUrl: s.baseUrl,
            model: freeModels.has("big-pickle") ? "big-pickle" : freeModels.ids()[0],
            fetchImpl: ctx?.probeFetch,
            bridgeFetch: subscriptionFetch ?? globalThis.fetch,
            clashQueue: clashProbeQueue,
          })
        )
      : attachAnonymousZenResult(networkProbe, null);
    probes.set(result);
    let addedIds: string[] = [];
    let proxyStillExists = false;
    const settings = await store.update((current) => {
      proxyStillExists = current.proxyPool.some((item) => item.id === result.id);
      if (!proxyStillExists) return {};
      const synced = syncAnonymousWorkers(current, [result], probes);
      addedIds = synced.addedIds;
      return {
        proxyPool: applyProbeEgressIps(current.proxyPool, [result]),
        ...(addedIds.length ? { accounts: synced.accounts } : {}),
      };
    });
    if (!proxyStillExists) probes.delete(result.id);
    if (addedIds.length) {
      upstream.updateSettings(settings);
      store.updateReadyCount(
        upstream.rotator.readyCount(),
        upstream.rotator.getAccounts().length
      );
    }
    sendJson(res, 200, {
      result,
      probeResults: probes.getAll(),
      settings,
      autoWorkers: { added: addedIds.length, addedIds },
    });
    return true;
  }

  // POST /admin/api/proxy-pool  — add manual proxy
  if (method === "POST" && path === "/admin/api/proxy-pool") {
    const raw = await readBody(req);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw.toString("utf8") || "{}") as Record<string, unknown>;
    } catch {
      sendJson(res, 400, { error: { message: "Invalid JSON" } });
      return true;
    }
    try {
      const saved = await store.addManualProxy({
        name: typeof body.name === "string" ? body.name : undefined,
        type: typeof body.type === "string" ? body.type : "http",
        host: String(body.host || ""),
        port: Number(body.port),
        username: typeof body.username === "string" ? body.username : undefined,
        password: typeof body.password === "string" ? body.password : undefined,
        enabled: body.enabled !== false,
      });
      upstream.updateSettings(saved);
      store.updateReadyCount(
        upstream.rotator.readyCount(),
        upstream.rotator.getAccounts().length
      );
      sendJson(res, 200, saved);
    } catch (err) {
      sendJson(res, 400, {
        error: { message: err instanceof Error ? err.message : String(err) },
      });
    }
    return true;
  }

  // DELETE /admin/api/proxy-pool — remove every proxy and unbind Workers.
  if (method === "DELETE" && path === "/admin/api/proxy-pool") {
    if (ctx.batchProbeProgress.running) {
      sendJson(res, 409, {
        error: {
          message: "Proxies cannot be removed while a batch proxy test is running",
          type: "batch_probe_running",
        },
      });
      return true;
    }
    const saved = await store.removeAllProxies();
    probes.clear();
    upstream.updateSettings(saved);
    store.updateReadyCount(
      upstream.rotator.readyCount(),
      upstream.rotator.getAccounts().length
    );
    sendJson(res, 200, saved);
    return true;
  }

  // DELETE /admin/api/proxy-pool/:id
  if (method === "DELETE" && path.startsWith("/admin/api/proxy-pool/")) {
    if (ctx.batchProbeProgress.running) {
      sendJson(res, 409, {
        error: {
          message: "Proxies cannot be removed while a batch proxy test is running",
          type: "batch_probe_running",
        },
      });
      return true;
    }
    const id = decodeURIComponent(path.slice("/admin/api/proxy-pool/".length));
    if (!id || id.includes("/")) {
      sendJson(res, 400, { error: { message: "Missing proxy id" } });
      return true;
    }
    const saved = await store.removeProxy(id);
    probes.delete(id);
    upstream.updateSettings(saved);
    store.updateReadyCount(
      upstream.rotator.readyCount(),
      upstream.rotator.getAccounts().length
    );
    sendJson(res, 200, saved);
    return true;
  }


  return false;
}
