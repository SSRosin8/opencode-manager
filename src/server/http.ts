/**
 * HTTP server composition and lifecycle.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { ClashSwitchQueue } from "../proxy/clashBridge.js";
import { FreeModelRegistry } from "../proxy/freeModels.js";
import { ProbeResultCache } from "../proxy/probe.js";
import { UpstreamClient } from "../proxy/upstream.js";
import { SettingsStore } from "../settings/store.js";
import { WorkerStatsStore } from "../settings/workerStats.js";
import { ProbeStateStore } from "../settings/probeState.js";
import { SessionAffinityStore } from "../settings/sessionAffinity.js";
import { ADMIN_HTML } from "./adminHtml.js";
import { newBatchProbeProgress, type RequestContext } from "./context.js";
import { BatchProbeControl } from "./batchProbeControl.js";
import { handleCoreAdmin } from "./handlers/coreAdmin.js";
import { handleProxyAdmin } from "./handlers/proxyAdmin.js";
import { handleRelay } from "./handlers/relay.js";
import { sendJson } from "./httpIO.js";
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
  // Session affinity survives restarts via a routing-only snapshot (session
  // ids + blob digests, no message content). Disabled under test runners so
  // relay tests stay hermetic.
  const sessionAffinity = process.env.VITEST ? null : new SessionAffinityStore(store.path);
  const upstream = new UpstreamClient(
    settings,
    opts?.fetchImpl,
    undefined,
    clashProbeQueue,
    undefined,
    sessionAffinity
      ? {
          save: (snapshot) => {
            void sessionAffinity.save(snapshot).catch(() => undefined);
          },
        }
      : null
  );
  if (sessionAffinity) {
    await sessionAffinity
      .load(new Set(settings.accounts.map((account) => account.id)))
      .then(
        (loaded) => upstream.restoreAffinity(loaded),
        () => undefined
      );
  }
  store.updateReadyCount(upstream.rotator.readyCount(), upstream.rotator.getAccounts().length);
  const probes = opts?.probes ?? new ProbeResultCache();
  const probeState = new ProbeStateStore(store.path);
  const batchProbeProgress = newBatchProbeProgress();
  const restoredProbeState = await probeState.load(
    new Set(settings.proxyPool.map((proxy) => proxy.id)),
    batchProbeProgress
  );
  probes.setMany(restoredProbeState.probeResults);
  Object.assign(batchProbeProgress, restoredProbeState.batchProbe);
  if (restoredProbeState.interrupted) {
    console.warn(
      `[probe-state] interrupted batch restored (${batchProbeProgress.completed}/${batchProbeProgress.total})`
    );
  } else if (restoredProbeState.probeResults.length) {
    console.log(`[probe-state] restored ${restoredProbeState.probeResults.length} probe results`);
  }
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
      egressIp: event.proxyId
        ? probes.get(event.proxyId)?.egressIp ?? proxy?.egressIp ?? null
        : null,
    });
  });

  const freeModels = opts?.freeModels ?? new FreeModelRegistry();
  if (opts?.freeModels) {
    // Test-injected registry: caller owns seeding; never hit the network.
  } else if (process.env.VITEST) {
    await freeModels.loadCache().catch(() => {});
  } else {
    await freeModels.loadCache().catch(() => {});
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
    batchProbeProgress,
    batchProbeControl: new BatchProbeControl(),
    probeState,
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
      // Never echo raw internals (proxy host:port, controller URLs, file
      // paths) to clients. Log the detail server-side, return a stable id.
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[http] unhandled request error: ${detail.slice(0, 500)}`);
      const status = 500;
      const type = "server_error";
      store.recordGatewayRejection({
        method: req.method || "UNKNOWN",
        path: safeRequestPath(req.url),
        status,
        type,
      });
      if (!res.headersSent) {
        sendJson(res, status, { error: { message: "Internal gateway error", type } });
      } else {
        res.destroy();
      }
    }
  });

  if (!opts?.freeModels && !process.env.VITEST) {
    const refreshFreeModels = async (): Promise<void> => {
      const status = await freeModels.refresh();
      if (status.lastError) {
        console.warn(
          `[free-models] refresh failed, using ${status.count} known-free: ${status.lastError}`
        );
      } else {
        console.log(`[free-models] refreshed ${status.count} models from the official Zen catalog`);
      }
    };
    void refreshFreeModels();
    const timer = setInterval(() => void refreshFreeModels(), 15 * 60 * 1000);
    timer.unref();
    server.once("close", () => clearInterval(timer));
  }

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
  const relayPath =
    path === "/models" ||
    path === "/chat/completions" ||
    path === "/responses" ||
    path.startsWith("/v1/");

  // Admin surface (HTML + /admin/api/*) is localhost-only by design. Relay
  // stays token-protected when configured; /health stays public for probes.
  const adminPath = path === "/" || path === "/admin" || path.startsWith("/admin/");
  if (adminPath && !isLoopbackRequest(req)) {
    ctx.store.recordGatewayRejection({ method, path, status: 403, type: "admin_forbidden" });
    sendJson(res, 403, {
      error: {
        message: "Admin UI/API is only available on localhost",
        type: "admin_forbidden",
      },
    });
    return;
  }

  if (relayPath) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Vary", "Origin");
  }
  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const relayAccessToken = ctx.store.get().relayAccessToken;
  if (relayPath && relayAccessToken && !isRelayAuthorized(req.headers["x-oc-relay-key"], relayAccessToken)) {
    ctx.store.recordGatewayRejection({ method, path, status: 401, type: "authentication_error" });
    sendJson(res, 401, {
      error: {
        message: "Invalid or missing relay access token",
        type: "authentication_error",
      },
    });
    return;
  }

  if (method === "GET" && (path === "/" || path === "/admin" || path === "/admin/")) {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
      "Referrer-Policy": "no-referrer",
    });
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
  if (relayPath) {
    ctx.store.recordGatewayRejection({ method, path, status: 404, type: "not_found" });
  }
  sendJson(res, 404, { error: { message: `Not found: ${path}`, type: "not_found" } });
}

function safeRequestPath(rawUrl: string | undefined): string {
  try {
    return new URL(rawUrl || "/", "http://localhost").pathname;
  } catch {
    return "/";
  }
}

/** Admin surface trusts loopback only; never treat X-Forwarded-For as proof. */
function isLoopbackRequest(req: IncomingMessage): boolean {
  const addr = req.socket?.remoteAddress ?? "";
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

/** Constant-time relay token compare to avoid timing side channels. */
function isRelayAuthorized(provided: unknown, expected: string): boolean {
  if (typeof provided !== "string" || !provided || !expected) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function listen(app: App): Promise<void> {
  return new Promise((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(app.port, app.host, () => {
      app.store.setRunning(true);
      if (app.host !== "127.0.0.1" && app.host !== "::1" && app.host !== "localhost") {
        console.warn(
          `[security] listening on non-loopback ${app.host}: relay routes require X-OC-Relay-Key, ` +
            `admin UI/API still rejects non-loopback clients. Do not expose this port publicly.`
        );
      }
      if (!app.store.get().relayAccessToken) {
        console.warn("[security] relayAccessToken is empty: /v1/* relay routes accept unauthenticated requests.");
      }
      resolve();
    });
  });
}

export function close(app: App): Promise<void> {
  const closeServer = new Promise<void>((resolve, reject) => {
    app.store.setRunning(false);
    app.server.close((error) => (error ? reject(error) : resolve()));
  });
  return closeServer.then(
    () => app.workerStats.close(),
    async (error: unknown) => {
      await app.workerStats.close();
      throw error;
    }
  );
}
