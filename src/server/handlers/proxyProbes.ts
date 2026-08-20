import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestContext } from "../context.js";
import { getClashSelectorCurrent, selectClashProxy } from "../../proxy/clashBridge.js";
import { probeAnonymousZenProxy, probePoolProxies, summarizeProbeResults, type AnonymousZenProbeResult, type ProbeResult } from "../../proxy/probe.js";
import type { GatewaySettings } from "../../settings/store.js";
import { batchProbeSnapshot } from "../context.js";
import { anonymousZenSummary, attachAnonymousZenResult, syncAnonymousWorkers } from "../workerEgress.js";
import { readBody, sendJson } from "../httpIO.js";

export async function handleProxyProbes(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: RequestContext
): Promise<boolean> {
  const {
    store, upstream, subscriptionFetch, probes, clashProbeQueue, freeModels,
    batchProbeProgress, batchProbeControl,
  } = ctx;
  const controlMatch = path.match(/^\/admin\/api\/proxy-pool\/test-batch\/(pause|resume|cancel)$/);
  if (method === "POST" && controlMatch) {
    if (!batchProbeProgress.running) {
      sendJson(res, 409, {
        error: { message: "No batch proxy test is running", type: "batch_probe_not_running" },
        progress: batchProbeSnapshot(batchProbeProgress),
      });
      return true;
    }
    const action = controlMatch[1];
    if (batchProbeProgress.cancelRequested && action !== "cancel") {
      sendJson(res, 409, {
        error: { message: "Batch proxy test cancellation is in progress", type: "batch_probe_cancelling" },
        progress: batchProbeSnapshot(batchProbeProgress),
      });
      return true;
    }
    if (action === "pause") {
      batchProbeControl.pause();
      batchProbeProgress.paused = true;
    } else if (action === "resume") {
      batchProbeControl.resume();
      batchProbeProgress.paused = false;
    } else {
      batchProbeControl.cancel();
      batchProbeProgress.paused = false;
      batchProbeProgress.cancelRequested = true;
    }
    batchProbeProgress.updatedAt = new Date().toISOString();
    sendJson(res, 200, { progress: batchProbeSnapshot(batchProbeProgress) });
    return true;
  }
  // POST /admin/api/proxy-pool/test-batch — latency probe (optional body.ids)
  if (method === "POST" && path === "/admin/api/proxy-pool/test-batch") {
    if (batchProbeProgress.running) {
      sendJson(res, 409, {
        error: { message: "A batch proxy test is already running", type: "batch_probe_running" },
        progress: batchProbeSnapshot(batchProbeProgress),
      });
      return true;
    }
    const startedAt = new Date().toISOString();
    batchProbeControl.reset();
    Object.assign(batchProbeProgress, {
      running: true,
      paused: false,
      cancelRequested: false,
      cancelled: false,
      total: 0,
      completed: 0,
      completedIds: [],
      stage: "screening",
      stageCompleted: 0,
      stageTotal: 0,
      addedWorkerIds: [],
      startedAt,
      updatedAt: startedAt,
      finishedAt: null,
      error: null,
    });
    const s = store.get();
    let ids: string[] | null = null;
    let raw: Buffer;
    try {
      raw = await readBody(req);
    } catch (err) {
      const finishedAt = new Date().toISOString();
      Object.assign(batchProbeProgress, {
        running: false,
        updatedAt: finishedAt,
        finishedAt,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
    if (raw.length) {
      try {
        const body = JSON.parse(raw.toString("utf8") || "{}") as { ids?: unknown };
        if (Array.isArray(body.ids)) {
          ids = body.ids.filter((x): x is string => typeof x === "string" && !!x);
        }
      } catch {
        const finishedAt = new Date().toISOString();
        Object.assign(batchProbeProgress, {
          running: false,
          updatedAt: finishedAt,
          finishedAt,
          error: "Invalid JSON",
        });
        sendJson(res, 400, { error: { message: "Invalid JSON" } });
        return true;
      }
    }
    const pool = s.proxyPool;
    const targets = ids?.length
      ? ids
          .map((id) => pool.find((p) => p.id === id))
          .filter((p): p is NonNullable<typeof p> => !!p)
      : pool;
    Object.assign(batchProbeProgress, {
      total: targets.length,
      updatedAt: new Date().toISOString(),
    });
    const bridgeFetch = subscriptionFetch ?? globalThis.fetch;
    const incrementallyAddedWorkerIds: string[] = [];
    let workerSyncChain = Promise.resolve();
    let workerSyncError: unknown = null;
    const enqueueResultWorkerSync = (result: ProbeResult): void => {
      workerSyncChain = workerSyncChain.then(async () => {
        const current = store.get();
        const synced = syncAnonymousWorkers(current, [result], probes);
        if (!synced.addedIds.length) return;
        const saved = await store.save({ accounts: synced.accounts });
        incrementallyAddedWorkerIds.push(...synced.addedIds);
        batchProbeProgress.addedWorkerIds.push(...synced.addedIds);
        batchProbeProgress.updatedAt = new Date().toISOString();
        upstream.updateSettings(saved);
        store.updateReadyCount(
          upstream.rotator.readyCount(),
          upstream.rotator.getAccounts().length
        );
      }).catch((err) => {
        workerSyncError ??= err;
      });
    };
    const shouldRestore = Boolean(
      s.clashBridge.enabled && targets.some((target) => target.source === "controller")
    );
    const previousNode = shouldRestore
      ? await getClashSelectorCurrent(s.clashBridge, bridgeFetch).catch(() => null)
      : null;
    let results: ProbeResult[] = [];
    let probeError: unknown = null;
    try {
      const anonymousByIp = new Map<string, Promise<AnonymousZenProbeResult>>();
      const anonymousModel = freeModels.has("big-pickle")
        ? "big-pickle"
        : freeModels.ids()[0];
      results = await probePoolProxies(targets, s.clashBridge, {
        fetchImpl: ctx?.probeFetch,
        bridgeFetch,
        clashQueue: clashProbeQueue,
        concurrency: 12,
        fastController: true,
        // Anonymous quotas are IP-sensitive, so every candidate needs a verified egress IP.
        verifyEgressCount: Math.max(1, targets.length),
        verifyProxyIds: s.accounts
          .map((account) => account.proxyId)
          .filter((id): id is string => Boolean(id)),
        checkpoint: () => batchProbeControl.checkpoint(),
        signal: batchProbeControl.signal(),
        afterProbe: async (proxy, result) => {
          if (!result.ok || !result.egressIp) {
            return attachAnonymousZenResult(result, null);
          }
          let check = anonymousByIp.get(result.egressIp);
          if (!check) {
            check = probeAnonymousZenProxy(proxy, s.clashBridge, {
              baseUrl: s.baseUrl,
              model: anonymousModel,
              // Batch checks share one Clash selector. Do not let one dead
              // egress block every remaining node for the 45s manual-test timeout.
              timeoutMs: 8_000,
              fetchImpl: ctx?.probeFetch,
              bridgeFetch,
              clashQueue: clashProbeQueue,
              // afterProbe executes while probePoolProxy still owns the Clash
              // queue, so switching or queueing again would add latency/deadlock.
              skipClashSwitch: true,
              signal: batchProbeControl.signal(),
            });
            anonymousByIp.set(result.egressIp, check);
          }
          const anonymous = await check;
          return attachAnonymousZenResult(result, { ...anonymous, id: result.id });
        },
        onResult: async (result, completed) => {
          probes.set(result);
          batchProbeProgress.completed = completed;
          batchProbeProgress.completedIds.push(result.id);
          batchProbeProgress.stage = "verifying";
          batchProbeProgress.stageCompleted = completed;
          batchProbeProgress.stageTotal = targets.length;
          batchProbeProgress.updatedAt = new Date().toISOString();
          enqueueResultWorkerSync(result);
        },
        onStageProgress: (stage, completed, total) => {
          batchProbeProgress.stage = stage;
          batchProbeProgress.stageCompleted = completed;
          batchProbeProgress.stageTotal = total;
          batchProbeProgress.updatedAt = new Date().toISOString();
        },
      });
      results = results.map((result) => {
        return result.anonymousZen === undefined
          ? attachAnonymousZenResult(result, null)
          : result;
      });
    } catch (err) {
      probeError = err;
    } finally {
      if (previousNode) {
        await clashProbeQueue
          .run(() => selectClashProxy(s.clashBridge, previousNode, bridgeFetch))
          .catch(() => undefined);
      }
    }
    if (probeError) {
      await workerSyncChain;
      const finalError = workerSyncError ?? probeError;
      const finishedAt = new Date().toISOString();
      Object.assign(batchProbeProgress, {
        running: false,
        updatedAt: finishedAt,
        finishedAt,
        error: finalError instanceof Error ? finalError.message : String(finalError),
      });
      throw finalError;
    }
    await workerSyncChain;
    return finishBatchProbe({
      res, store, upstream, probes, results, targets, batchProbeProgress,
      workerSyncError, incrementallyAddedWorkerIds,
      cancelled: batchProbeControl.isCancelled(),
    });
  }

  return false;
}

async function finishBatchProbe(args: {
  res: ServerResponse;
  store: RequestContext["store"];
  upstream: RequestContext["upstream"];
  probes: RequestContext["probes"];
  results: ProbeResult[];
  targets: ReturnType<RequestContext["store"]["get"]>["proxyPool"];
  batchProbeProgress: RequestContext["batchProbeProgress"];
  workerSyncError: unknown;
  incrementallyAddedWorkerIds: string[];
  cancelled: boolean;
}): Promise<boolean> {
  const {
    res, store, upstream, probes, results, targets, batchProbeProgress,
    workerSyncError, incrementallyAddedWorkerIds, cancelled,
  } = args;
  if (workerSyncError) {
    const message = workerSyncError instanceof Error ? workerSyncError.message : String(workerSyncError);
    const finishedAt = new Date().toISOString();
    Object.assign(batchProbeProgress, { running: false, updatedAt: finishedAt, finishedAt, error: message });
    throw workerSyncError;
  }
  probes.setMany(results);
  const synced = syncAnonymousWorkers(store.get(), results, probes);
  let saved: GatewaySettings;
  try {
    saved = synced.addedIds.length
      ? await store.save({ accounts: synced.accounts })
      : store.get();
  } catch (error) {
    const failedAt = new Date().toISOString();
    Object.assign(batchProbeProgress, {
      running: false,
      updatedAt: failedAt,
      finishedAt: failedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  if (synced.addedIds.length) {
    batchProbeProgress.addedWorkerIds.push(...synced.addedIds);
    upstream.updateSettings(saved);
    store.updateReadyCount(
      upstream.rotator.readyCount(),
      upstream.rotator.getAccounts().length
    );
  }
  const finishedAt = new Date().toISOString();
  Object.assign(batchProbeProgress, {
    running: false,
    paused: false,
    cancelRequested: false,
    cancelled,
    completed: results.length,
    stage: "verifying",
    stageCompleted: results.length,
    stageTotal: targets.length,
    updatedAt: finishedAt,
    finishedAt,
    error: null,
  });
  sendJson(res, 200, {
    results,
    summary: summarizeProbeResults(results),
    anonymousSummary: anonymousZenSummary(results),
    probeResults: probes.getAll(),
    autoWorkers: {
      added: incrementallyAddedWorkerIds.length + synced.addedIds.length,
      addedIds: [...incrementallyAddedWorkerIds, ...synced.addedIds],
    },
    settings: saved,
    progress: batchProbeSnapshot(batchProbeProgress),
    cancelled,
  });
  return true;
}
