/**
 * HTTP server composition and lifecycle.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { ClashSwitchQueue } from "../proxy/clashBridge.js";
import { FreeModelRegistry } from "../proxy/freeModels.js";
import { ProbeResultCache } from "../proxy/probe.js";
import { UpstreamClient } from "../proxy/upstream.js";
import { SettingsStore } from "../settings/store.js";
import { WorkerStatsStore } from "../settings/workerStats.js";
import { ADMIN_HTML } from "./adminHtml.js";
import { newBatchProbeProgress, type RequestContext } from "./context.js";
import { BatchProbeControl } from "./batchProbeControl.js";
import { handleCoreAdmin } from "./handlers/coreAdmin.js";
import { handleProxyAdmin } from "./handlers/proxyAdmin.js";
import { handleRelay } from "./handlers/relay.js";
import { RequestBodyTooLargeError, sendJson } from "./httpIO.js";
import { credentialLabel } from "./workerEgress.js";

export type App = {
  server: Server;
  store: SettingsStore;
  upstream: UpstreamClient;
  port: number;
  host: string;
  probes: ProbeResultCache;
  workerStats: WorkerStatsStore;
  freeModels: FreeModelRegistry;
};

export async function createApp(opts?: {
  store?: SettingsStore;
  port?: number;
  host?: string;
  fetchImpl?: ConstructorParameters<typeof UpstreamClient>[1];
  /** For subscription fetch tests. */
  subscriptionFetch?: typeof fetch;
  /** Override probe HTTP fetch (unit tests). */
  probeFetch?: import("../proxy/probe.js").ProbeFetch;
  probes?: ProbeResultCache;
  workerStats?: WorkerStatsStore;
  /** Free-model registry for the free-only filter. Injected for tests. */
  freeModels?: FreeModelRegistry;
}): Promise<App> {
  const store = opts?.store ?? new SettingsStore();
  await store.load();
  const settings = store.get();
  const clashProbeQueue = new ClashSwitchQueue();
  const upstream = new UpstreamClient(settings, opts?.fetchImpl, undefined, clashProbeQueue);
  store.updateReadyCount(upstream.rotator.readyCount(), upstream.rotator.getAccounts().length);
  const probes = opts?.probes ?? new ProbeResultCache();
  const workerStats =
    opts?.workerStats ??
    new WorkerStatsStore({
      persist: !opts?.workerStats && process.env.VITEST ? false : undefined,
    });
  if (!opts?.workerStats) await workerStats.load().catch(() => {});

  upstream.setAttemptObserver((event) => {
    const current = store.get();
    const account = current.accounts.find((item) => item.id === event.accountId);
    const proxy = event.proxyId
      ? current.proxyPool.find((item) => item.id === event.proxyId)
      : null;
    workerStats.recordAttempt(event, {
      credentialLabel: credentialLabel(event.accountKind, account?.apiKey ?? ""),
      proxyName: proxy?.name ?? event.clashNodeName,
      egressIp: event.proxyId ? probes.get(event.proxyId)?.egressIp ?? null : null,
    });
  });

  const freeModels = opts?.freeModels ?? new FreeModelRegistry();
  if (opts?.freeModels) {
    // Test-injected registry: caller owns seeding; never hit the network.
  } else if (process.env.VITEST) {
    await freeModels.loadCache().catch(() => {});
  } else {
    await freeModels.loadCache().catch(() => {});
    freeModels.refresh().then((status) => {
      if (status.lastError) {
        console.warn(
          `[free-models] refresh failed, using ${status.count} known-free: ${status.lastError}`
        );
      } else {
        console.log(`[free-models] scraped ${status.count} free models from opencode.ai/docs/zen`);
      }
    });
  }

  const context: RequestContext = {
    store,
    upstream,
    subscriptionFetch: opts?.subscriptionFetch,
    probeFetch: opts?.probeFetch,
    probes,
    clashProbeQueue,
    workerStats,
    freeModels,
    batchProbeProgress: newBatchProbeProgress(),
    batchProbeControl: new BatchProbeControl(),
  };
  const port =
    opts?.port ??
    (process.env.PORT ? Number(process.env.PORT) : undefined) ??
    settings.port ??
    9876;
  const host = opts?.host ?? (process.env.OPENCODE_MANAGER_HOST?.trim() || "127.0.0.1");

  const server = createServer(async (req, res) => {
    try {
      await handleRequest(req, res, context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = error instanceof RequestBodyTooLargeError ? error.status : 500;
      const type = status === 413 ? "request_body_too_large" : "server_error";
      store.recordRequest(req.url || "/", status, message);
      if (!res.headersSent) {
        sendJson(res, status, { error: { message, type } });
      } else {
        res.destroy();
      }
    }
  });

  return { server, store, upstream, port, host, probes, workerStats, freeModels };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RequestContext
): Promise<void> {
  const method = (req.method || "GET").toUpperCase();
  const url = new URL(req.url || "/", "http://localhost");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const relayPath = path === "/models" || path === "/chat/completions" || path.startsWith("/v1/");

  if (relayPath) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const relayAccessToken = ctx.store.get().relayAccessToken;
  if (relayPath && relayAccessToken && req.headers["x-oc-relay-key"] !== relayAccessToken) {
    sendJson(res, 401, {
      error: {
        message: "Invalid or missing relay access token",
        type: "authentication_error",
      },
    });
    return;
  }

  if (method === "GET" && (path === "/" || path === "/admin" || path === "/admin/")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(ADMIN_HTML);
    return;
  }
  if (method === "GET" && path === "/health") {
    sendJson(res, 200, { ok: true, service: "opencode-manager" });
    return;
  }

  if (await handleCoreAdmin(req, res, method, path, ctx)) return;
  if (await handleProxyAdmin(req, res, method, path, ctx)) return;
  if (await handleRelay(req, res, method, path, ctx)) return;
  sendJson(res, 404, { error: { message: `Not found: ${path}`, type: "not_found" } });
}

export function listen(app: App): Promise<void> {
  return new Promise((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(app.port, app.host, () => {
      app.store.setRunning(true);
      resolve();
    });
  });
}

export function close(app: App): Promise<void> {
  return new Promise((resolve, reject) => {
    app.store.setRunning(false);
    app.server.close((error) => (error ? reject(error) : resolve()));
  });
}
