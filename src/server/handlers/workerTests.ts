import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestContext } from "../context.js";
import { probeAnonymousZenProxy, probePoolProxy } from "../../proxy/probe.js";
import { inferAccountKind } from "../../relay/index.js";
import { attachAnonymousZenResult } from "../workerEgress.js";
import { readStreamFully, sendJson } from "../httpIO.js";

export async function handleWorkerTests(
  _req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: RequestContext
): Promise<boolean> {
  const { store, upstream, subscriptionFetch, probes, clashProbeQueue, freeModels } = ctx;
  // POST /admin/api/workers/:id/test — real OpenCode request through one bound worker
  if (method === "POST" && path.match(/^\/admin\/api\/workers\/[^/]+\/test$/)) {
    const id = decodeURIComponent(path.slice("/admin/api/workers/".length, -"/test".length));
    const s = store.get();
    const account = s.accounts.find((item) => item.id === id);
    if (!account) {
      sendJson(res, 404, { error: { message: `Worker not found: ${id}` } });
      return true;
    }
    if (!account.proxyId) {
      sendJson(res, 400, { error: { message: `Worker "${id}" has no proxy binding` } });
      return true;
    }
    const proxy = s.proxyPool.find((item) => item.id === account.proxyId);
    if (!proxy) {
      sendJson(res, 400, { error: { message: `Bound proxy not found: ${account.proxyId}` } });
      return true;
    }
    const started = performance.now();
    try {
      const kind = inferAccountKind(account);
      const networkProbe = await probePoolProxy(proxy, s.clashBridge, {
        fetchImpl: ctx?.probeFetch,
        bridgeFetch: subscriptionFetch ?? globalThis.fetch,
        clashQueue: clashProbeQueue,
      });
      const probe = kind === "anonymous_zen" && networkProbe.ok
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
      probes.set(probe);
      if (!probe.ok) {
        sendJson(res, 502, {
          ok: false,
          workerId: id,
          proxyId: proxy.id,
          proxyName: proxy.name,
          egressIp: probe.egressIp ?? null,
          latencyMs: Math.round(performance.now() - started),
          error: { message: `Egress probe failed: ${probe.error || "unknown error"}` },
        });
        return true;
      }
      if (kind === "anonymous_zen" && !probe.anonymousZen?.ok) {
        sendJson(res, 502, {
          ok: false,
          workerId: id,
          proxyId: proxy.id,
          proxyName: proxy.name,
          egressIp: probe.egressIp ?? null,
          anonymousZen: probe.anonymousZen,
          latencyMs: Math.round(performance.now() - started),
          error: {
            message: `Anonymous Zen probe failed: ${probe.anonymousZen?.error || "unknown error"}`,
          },
        });
        return true;
      }
      const model = freeModels.has("big-pickle") ? "big-pickle" : freeModels.ids()[0];
      if (!model) throw new Error("No free model available for worker test");
      if (kind === "anonymous_zen") {
        sendJson(res, 200, {
          ok: true,
          workerId: id,
          workerKind: kind,
          proxyId: proxy.id,
          proxyName: proxy.name,
          egressIp: probe.egressIp ?? null,
          model,
          upstreamStatus: probe.anonymousZen?.httpStatus ?? null,
          latencyMs: Math.round(performance.now() - started),
          anonymousZen: probe.anonymousZen,
          reply: null,
          error: null,
        });
        return true;
      }
      const result = await upstream.testAccountConnection(id, model);
      let reply: string | null = null;
      let upstreamError: string | null = null;
      if (result.body) {
        const text = Buffer.from(await readStreamFully(result.body)).toString("utf8");
        try {
          const parsed = JSON.parse(text) as {
            choices?: Array<{ message?: { content?: unknown } }>;
            error?: { message?: unknown; type?: unknown };
          };
          const content = parsed.choices?.[0]?.message?.content;
          reply = typeof content === "string" ? content.slice(0, 160) : null;
          if (parsed.error) {
            upstreamError = [parsed.error.type, parsed.error.message]
              .filter((value) => typeof value === "string")
              .join(": ")
              .slice(0, 300);
          }
        } catch {
          upstreamError = result.status >= 400 ? `upstream HTTP ${result.status}` : null;
        }
      }
      const ok = result.status >= 200 && result.status < 300;
      sendJson(res, ok ? 200 : 502, {
        ok,
        workerId: id,
        proxyId: result.proxyId,
        proxyName: proxy.name,
        clashNodeName: result.clashNodeName,
        egressIp: probe.egressIp ?? null,
        anonymousZen: probe.anonymousZen,
        model,
        upstreamStatus: result.status,
        latencyMs: Math.round(performance.now() - started),
        reply,
        error: ok ? null : { message: upstreamError || `upstream HTTP ${result.status}` },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 502, {
        ok: false,
        workerId: id,
        proxyId: proxy.id,
        proxyName: proxy.name,
        latencyMs: Math.round(performance.now() - started),
        error: { message },
      });
    }
    return true;
  }


  return false;
}
