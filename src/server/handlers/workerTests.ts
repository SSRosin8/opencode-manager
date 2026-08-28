import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestContext } from "../context.js";
import { persistProbeState } from "../context.js";
import { probeAnonymousZenProxy, probePoolProxy } from "../../proxy/probe.js";
import { applyProbeEgressIps } from "../../proxy/pool.js";
import { inferAccountKind } from "../../relay/index.js";
import { attachAnonymousZenResult } from "../workerEgress.js";
import { UpstreamResponseTooLargeError, readBody, readStreamFully, sendJson } from "../httpIO.js";
import { logProbeFailure } from "../probeDiagnostics.js";
import { activateBridge, resolveBridge } from "../../proxy/bridgeRuntime.js";
import { normalizeModelName } from "../../proxy/freeModels.js";

const MAX_WORKER_TEST_RESPONSE_BYTES = 1024 * 1024;

function safeUpstreamMessage(value: string | null, status: number): string {
  const type = value?.split(":", 1)[0]?.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80);
  return type ? `${type}: upstream HTTP ${status}` : `upstream HTTP ${status}`;
}

export async function handleWorkerTests(
  req: IncomingMessage,
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
    const kind = inferAccountKind(account);
    if (kind === "authenticated_zen" && !account.apiKey.trim()) {
      sendJson(res, 400, {
        error: {
          message: `Signed-in Zen Worker "${id}" requires an API key before testing`,
          type: "worker_api_key_required",
        },
      });
      return true;
    }
    let requestedModel: string | null = null;
    try {
      const raw = await readBody(req);
      if (raw.length) {
        const parsed: unknown = JSON.parse(raw.toString("utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("request body must be a JSON object");
        }
        const body = parsed as { model?: unknown };
        if (body.model !== undefined &&
            (typeof body.model !== "string" || !body.model.trim())) {
          throw new Error("model must be a string");
        }
        requestedModel = typeof body.model === "string" ? body.model.trim() : null;
      }
    } catch (error) {
      sendJson(res, 400, {
        error: {
          message: error instanceof Error ? error.message : "Invalid JSON",
          type: "invalid_worker_test_request",
        },
      });
      return true;
    }
    const normalizedRequestedModel = requestedModel
      ? normalizeModelName(requestedModel.replace(/^opencode\//i, ""))
      : null;
    const model = normalizedRequestedModel
      ? freeModels.ids().find((item) => item === normalizedRequestedModel)
      : freeModels.has("big-pickle") ? "big-pickle" : freeModels.ids()[0];
    if (!model) {
      sendJson(res, 400, {
        error: {
          message: requestedModel
            ? `Model "${requestedModel.slice(0, 120)}" is not an official free model`
            : "No official free model is available for Worker testing",
          type: requestedModel ? "model_not_allowed" : "no_free_model_available",
        },
      });
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
      let resolvedBridge = s.clashBridge;
      if (!proxy.usable) {
        if (proxy.bridgeId) {
          const profile = (s.clashBridge.bridges ?? []).find((item) => item.id === proxy.bridgeId);
          if (profile && profile.enabled && s.clashBridge.enabled) {
            resolvedBridge = activateBridge(s.clashBridge, profile);
          } else {
            const fallback = await resolveBridge(s.clashBridge, proxy.clashNodeName || proxy.name, subscriptionFetch ?? globalThis.fetch);
            resolvedBridge = fallback.bridge;
          }
        } else {
          const fallback = await resolveBridge(s.clashBridge, proxy.clashNodeName || proxy.name, subscriptionFetch ?? globalThis.fetch);
          resolvedBridge = fallback.bridge;
        }
      }
      const networkProbe = await probePoolProxy(proxy, resolvedBridge, {
        fetchImpl: ctx?.probeFetch,
        bridgeFetch: subscriptionFetch ?? globalThis.fetch,
        clashQueue: clashProbeQueue,
      });
      const probe = kind === "anonymous_zen" && networkProbe.ok
        ? attachAnonymousZenResult(
            networkProbe,
            await probeAnonymousZenProxy(proxy, resolvedBridge, {
              baseUrl: s.baseUrl,
              model,
              fetchImpl: ctx?.probeFetch,
              bridgeFetch: subscriptionFetch ?? globalThis.fetch,
              clashQueue: clashProbeQueue,
            })
          )
        : attachAnonymousZenResult(networkProbe, null);
      probes.set(probe);
      if (!probe.ok || (kind === "anonymous_zen" && !probe.anonymousZen?.ok)) {
        logProbeFailure("single", probe);
      }
      await persistProbeState(ctx);
      if (probe.ok && probe.egressIp) {
        const saved = await store.save({
          proxyPool: applyProbeEgressIps(store.get().proxyPool, [probe]),
        });
        upstream.updateSettings(saved);
      }
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
        const text = (await readStreamFully(result.body, MAX_WORKER_TEST_RESPONSE_BYTES)).toString("utf8");
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
        error: ok ? null : { message: safeUpstreamMessage(upstreamError, result.status) },
      });
    } catch (err) {
      const tooLarge = err instanceof UpstreamResponseTooLargeError;
      const message = tooLarge ? err.message : "Worker test request failed";
      sendJson(res, 502, {
        ok: false,
        workerId: id,
        proxyId: proxy.id,
        proxyName: proxy.name,
        latencyMs: Math.round(performance.now() - started),
        error: {
          message,
          ...(tooLarge ? { type: "upstream_response_too_large" } : {}),
        },
      });
    }
    return true;
  }


  return false;
}
