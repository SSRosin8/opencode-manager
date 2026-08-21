import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestContext } from "../context.js";
import { inferAccountKind } from "../../relay/index.js";
import type { GatewaySettings } from "../../settings/store.js";
import { credentialLabel, duplicateWorkerEgress } from "../workerEgress.js";
import { readBody, sendJson } from "../httpIO.js";
import { setupReadiness } from "../readiness.js";

const GATEWAY_SETTING_KEYS = new Set([
  "baseUrl", "relayAccessToken", "synthesizeCliHeaders", "cliUserAgent",
  "cliClient", "cliProject", "routingStrategy", "port",
]);

export async function handleCoreSettings(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: RequestContext
): Promise<boolean> {
  const { store, upstream, probes, workerStats, freeModels, batchProbeProgress } = ctx;
  if (method === "PATCH" && path === "/admin/api/gateway-settings") {
    const raw = await readBody(req);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw.toString("utf8") || "{}") as Record<string, unknown>;
    } catch {
      sendJson(res, 400, { error: { message: "Invalid JSON" } });
      return true;
    }
    const unexpected = Object.keys(body).filter((key) => !GATEWAY_SETTING_KEYS.has(key));
    if (unexpected.length) {
      sendJson(res, 400, {
        error: { type: "invalid_gateway_settings", message: `Unexpected fields: ${unexpected.join(", ")}` },
      });
      return true;
    }
    const saved = await store.save(body as Partial<GatewaySettings>);
    upstream.updateSettings(saved);
    store.updateReadyCount(upstream.rotator.readyCount(), upstream.rotator.getAccounts().length);
    sendJson(res, 200, { settings: saved });
    return true;
  }
  // Free-model registry status
  if (method === "GET" && path === "/admin/api/free-models") {
    sendJson(res, 200, freeModels.status());
    return true;
  }
  // Force a refresh from the official Zen model catalog.
  if (method === "POST" && path === "/admin/api/free-models/refresh") {
    const status = await freeModels.refresh();
    sendJson(res, 200, status);
    return true;
  }

  // Admin API: settings
  if (path === "/admin/api/settings") {
    if (method === "GET") {
      sendJson(res, 200, store.get());
      return true;
    }
    if (method === "PUT" || method === "POST") {
      const raw = await readBody(req);
      let parsed: Partial<GatewaySettings>;
      try {
        parsed = JSON.parse(raw.toString("utf8") || "{}") as Partial<GatewaySettings>;
      } catch {
        sendJson(res, 400, { error: { message: "Invalid JSON" } });
        return true;
      }
      if (Array.isArray(parsed.accounts)) {
        const ids = parsed.accounts.map((account) => String(account?.id || "").trim());
        if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
          sendJson(res, 400, {
            error: { type: "invalid_worker_ids", message: "Worker IDs must be non-empty and unique" },
          });
          return true;
        }
        if (batchProbeProgress.running) {
          sendJson(res, 409, {
            error: {
              type: "batch_probe_running",
              message: "Workers cannot be saved while a batch proxy test is running",
            },
          });
          return true;
        }
        const duplicate = duplicateWorkerEgress(parsed.accounts, probes);
        if (duplicate) {
          sendJson(res, 400, {
            error: {
              type: "duplicate_worker_egress",
              message: `${duplicate.kind} workers ${duplicate.accountIds.join(", ")} share ${duplicate.route}`,
            },
          });
          return true;
        }
      }
      const saved = await store.save(parsed);
      upstream.updateSettings(saved);
      store.updateReadyCount(
        upstream.rotator.readyCount(),
        upstream.rotator.getAccounts().length
      );
      sendJson(res, 200, saved);
      return true;
    }
  }

  if (method === "GET" && path === "/admin/api/status") {
    store.updateReadyCount(
      upstream.rotator.readyCount(),
      upstream.rotator.getAccounts().length
    );
    const currentSettings = store.get();
    const accounts = currentSettings.accounts;
    const accountIds = accounts.map((a) => a.id);
    const proxyById = new Map(currentSettings.proxyPool.map((proxy) => [proxy.id, proxy] as const));
    const recentAttempts = workerStats.recentAttempts(100).map((attempt) => ({
      ...attempt,
      egressIp: attempt.egressIp ?? (attempt.proxyId ? proxyById.get(attempt.proxyId)?.egressIp : null) ?? null,
    }));
    const latestAttemptEgress = new Map<string, string>();
    for (const attempt of recentAttempts) {
      if (attempt.egressIp && !latestAttemptEgress.has(attempt.accountId)) {
        latestAttemptEgress.set(attempt.accountId, attempt.egressIp);
      }
    }
    const rotatorStates = new Map(
      upstream.rotator.getAccounts().map((account) => [account.id, account] as const)
    );
    const workers = workerStats.listForAccounts(accountIds).map((worker) => {
      const account = accounts.find((item) => item.id === worker.accountId);
      const kind = account ? inferAccountKind(account) : "anonymous_zen";
      const proxy = account?.proxyId
        ? proxyById.get(account.proxyId)
        : null;
      const state = rotatorStates.get(worker.accountId);
      return {
        ...worker,
        kind,
        enabled: account?.enabled !== false,
        credentialLabel: credentialLabel(kind, account?.apiKey ?? ""),
        proxyId: account?.proxyId ?? null,
        proxyName: proxy?.name ?? state?.clashNodeName ?? null,
        egressIp: account?.proxyId
          ? probes.get(account.proxyId)?.egressIp ?? proxy?.egressIp ?? latestAttemptEgress.get(worker.accountId) ?? null
          : latestAttemptEgress.get(worker.accountId) ?? null,
        ready: state ? upstream.rotator.isReady(state) : false,
        cooldownUntil: state?.cooldownUntil ?? 0,
      };
    });
    const anonymousIds = accounts
      .filter((account) => inferAccountKind(account) === "anonymous_zen")
      .map((account) => account.id);
    const authenticatedIds = accounts
      .filter((account) => inferAccountKind(account) === "authenticated_zen")
      .map((account) => account.id);
    sendJson(res, 200, {
      ...store.getStatus(),
      readiness: setupReadiness(store.get(), probes, upstream.rotator.readyCount()),
      routingStrategy: store.get().routingStrategy,
      workers,
      usageTotals: workerStats.totals(accountIds),
      usageTotalsByKind: {
        anonymous_zen: workerStats.totals(anonymousIds),
        authenticated_zen: workerStats.totals(authenticatedIds),
      },
      recentAttempts,
    });
    return true;
  }


  return false;
}
