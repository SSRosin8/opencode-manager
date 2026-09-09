import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestContext } from "../context.js";
import { getClashSelectorCurrent, selectClashProxy } from "../../proxy/clashBridge.js";
import { DEFAULT_ANONYMOUS_ZEN_TIMEOUT_MS, probeAnonymousZenProxy, probePoolProxies, summarizeProbeResults, type AnonymousZenProbeResult, type ProbeResult } from "../../proxy/probe.js";
import type { GatewaySettings } from "../../settings/store.js";
import { applyProbeEgressIps } from "../../proxy/pool.js";
import { batchProbeSnapshot, persistProbeState } from "../context.js";
import { anonymousZenSummary, attachAnonymousZenResult, syncAnonymousWorkers } from "../workerEgress.js";
import { AdminBodyTooLargeError, readJsonBody, sendJson } from "../httpIO.js";
import { logBatchSummary, logProbeFailure } from "../probeDiagnostics.js";
import { activateBridge, resolveBridge } from "../../proxy/bridgeRuntime.js";
import type { ClashBridgeConfig, PoolProxy } from "../../proxy/pool.js";

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
    void persistProbeState(ctx).catch((error) => {
      console.warn(`[probe-state] save failed: ${error instanceof Error ? error.message : String(error)}`);
    });
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
    await persistProbeState(ctx);
    const s = store.get();
    let ids: string[] | null = null;
    let raw: Buffer;
    try {
      // Batch options are tiny (optional id list); bound tightly. Relay chat
      // passthrough stays unbounded by design (large multimodal payloads).
      raw = await readJsonBody(req, 256 * 1024);
    } catch (err) {
      const finishedAt = new Date().toISOString();
      const tooLarge = err instanceof AdminBodyTooLargeError;
      Object.assign(batchProbeProgress, {
        running: false,
        updatedAt: finishedAt,
        finishedAt,
        error: err instanceof Error ? err.message : String(err),
      });
      await persistProbeState(ctx);
      if (tooLarge) {
        sendJson(res, 413, {
          error: { message: (err as Error).message, type: "body_too_large" },
          progress: batchProbeSnapshot(batchProbeProgress),
        });
        return true;
      }
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
        await persistProbeState(ctx);
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
    await persistProbeState(ctx);
    const bridgeFetch = subscriptionFetch ?? globalThis.fetch;
    const incrementallyAddedWorkerIds: string[] = [];
    let workerSyncChain = Promise.resolve();
    let workerSyncError: unknown = null;
    const enqueueResultWorkerSync = (result: ProbeResult): void => {
      workerSyncChain = workerSyncChain.then(async () => {
        const current = store.get();
        const synced = syncAnonymousWorkers(current, [result]);
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
        await persistProbeState(ctx);
      }).catch((err) => {
        workerSyncError ??= err;
      });
    };
    // Multi-bridge grouping: controller nodes are routed via owning bridge.
    const controllerGroups = new Map<string, { bridge: ClashBridgeConfig; proxies: PoolProxy[]; indexes: number[] }>();
    const genericProxies: PoolProxy[] = [];
    const genericIndexes: number[] = [];
    for (let i = 0; i < targets.length; i++) {
      const proxy = targets[i] as PoolProxy;
      if (proxy.source === "controller" && proxy.bridgeId) {
        const profile = (s.clashBridge.bridges ?? []).find((item) => item.id === proxy.bridgeId);
        if (profile && profile.enabled && s.clashBridge.enabled) {
          const bridge = activateBridge(s.clashBridge, profile);
          let entry = controllerGroups.get(proxy.bridgeId);
          if (!entry) entry = { bridge, proxies: [], indexes: [] };
          else entry.bridge = bridge;
          entry.proxies.push(proxy);
          entry.indexes.push(i);
          controllerGroups.set(proxy.bridgeId, entry);
          continue;
        }
      }
      genericProxies.push(proxy);
      genericIndexes.push(i);
    }
    const previousNodes = new Map<string, string | null>();
    for (const [bridgeId, entry] of controllerGroups) {
      if (entry.proxies.some((proxy) => proxy.source === "controller")) {
        try {
          const cur = await getClashSelectorCurrent(entry.bridge, bridgeFetch).catch(() => null);
          previousNodes.set(bridgeId, cur);
        } catch {
          previousNodes.set(bridgeId, null);
        }
      }
    }
    // Fallback bridge for generic (including legacy controller without bridgeId)
    let genericBridge: ClashBridgeConfig = s.clashBridge;
    let genericPreviousNode: string | null = null;
    if (genericProxies.length) {
      const genericTarget = genericProxies.find((proxy) => !proxy.usable)?.clashNodeName;
      if (genericTarget) {
        try {
          const resolved = await resolveBridge(s.clashBridge, genericTarget, bridgeFetch);
          genericBridge = resolved.bridge;
        } catch {
          genericBridge = s.clashBridge;
        }
      }
      const needRestore = genericBridge.enabled && genericProxies.some((proxy) => proxy.source === "controller");
      if (needRestore) {
        try {
          genericPreviousNode = await getClashSelectorCurrent(genericBridge, bridgeFetch).catch(() => null);
        } catch {
          genericPreviousNode = null;
        }
      }
    }
    let results: ProbeResult[] = [];
    let probeError: unknown = null;
    try {
      const anonymousByIp = new Map<string, Promise<AnonymousZenProbeResult>>();
      const anonymousModel = freeModels.has("big-pickle")
        ? "big-pickle"
        : freeModels.ids()[0];
      const fallbackAnonymousModel = freeModels.ids().find((model) => model !== anonymousModel);
      let previousProviderFailureEgress: string | null = null;
      let crossCheckClaimed = false;
      const createAfterProbe = (bridge: ClashBridgeConfig) => async (proxy: PoolProxy, result: ProbeResult) => {
          if (!result.ok || !result.egressIp) {
            return attachAnonymousZenResult(result, null);
          }
          let check = anonymousByIp.get(result.egressIp);
          if (!check) {
            check = probeAnonymousZenProxy(proxy, bridge, {
              baseUrl: s.baseUrl,
              model: anonymousModel,
              timeoutMs: DEFAULT_ANONYMOUS_ZEN_TIMEOUT_MS,
              fetchImpl: ctx?.probeFetch,
              bridgeFetch,
              clashQueue: clashProbeQueue,
              skipClashSwitch: true,
              signal: batchProbeControl.signal(),
            });
            anonymousByIp.set(result.egressIp, check);
          }
          const anonymous = await check;
          const matchingFailure = anonymous.httpStatus === 503 && anonymous.reasonCode === "upstream_failure";
          const shouldCrossCheck = matchingFailure && !crossCheckClaimed &&
            Boolean(fallbackAnonymousModel) && previousProviderFailureEgress !== null &&
            previousProviderFailureEgress !== result.egressIp;
          if (matchingFailure) previousProviderFailureEgress = result.egressIp;
          else previousProviderFailureEgress = null;
          if (shouldCrossCheck && fallbackAnonymousModel) {
            crossCheckClaimed = true;
            const fallback = await probeAnonymousZenProxy(proxy, bridge, {
              baseUrl: s.baseUrl,
              model: fallbackAnonymousModel,
              timeoutMs: DEFAULT_ANONYMOUS_ZEN_TIMEOUT_MS,
              fetchImpl: ctx?.probeFetch,
              bridgeFetch,
              clashQueue: clashProbeQueue,
              skipClashSwitch: true,
              signal: batchProbeControl.signal(),
            });
            const providerFailure = fallback.httpStatus === 503 && fallback.reasonCode === "upstream_failure";
            const diagnosis = fallback.ok ? "primary_model_failure" : providerFailure ? "provider_failure" : "inconclusive";
            return attachAnonymousZenResult(result, {
              ...anonymous,
              id: result.id,
              ...(fallback.ok ? {
                status: "usable" as const,
                ok: true,
                httpStatus: fallback.httpStatus,
                latencyMs: fallback.latencyMs,
                error: null,
                model: fallbackAnonymousModel,
              } : {}),
              ...(diagnosis !== "inconclusive" ? { reasonCode: diagnosis } : {}),
              diagnosis,
              crossCheck: {
                model: fallbackAnonymousModel,
                status: fallback.status,
                ok: fallback.ok,
                httpStatus: fallback.httpStatus,
                latencyMs: fallback.latencyMs,
                error: fallback.error,
                ...(fallback.reasonCode ? { reasonCode: fallback.reasonCode } : {}),
              },
            });
          }
          return attachAnonymousZenResult(result, { ...anonymous, id: result.id });
        };
      const indexedResults: Array<ProbeResult | undefined> = new Array(targets.length);
      let globalCompleted = 0;
      const handleGroupResult = async (result: ProbeResult) => {
          logProbeFailure("batch", result);
          probes.set(result);
          enqueueResultWorkerSync(result);
          await workerSyncChain;
          globalCompleted += 1;
          batchProbeProgress.completed = globalCompleted;
          batchProbeProgress.completedIds.push(result.id);
          batchProbeProgress.stage = "verifying";
          batchProbeProgress.stageCompleted = globalCompleted;
          batchProbeProgress.stageTotal = targets.length;
          batchProbeProgress.updatedAt = new Date().toISOString();
          void persistProbeState(ctx).catch((error) => {
            console.warn(`[probe-state] save failed: ${error instanceof Error ? error.message : String(error)}`);
          });
        };
      const bridgeGroupsInOrder: Array<{ bridge: ClashBridgeConfig; proxies: PoolProxy[]; indexes: number[] }> = [];
      for (const entry of controllerGroups.values()) bridgeGroupsInOrder.push(entry);
      if (genericProxies.length) bridgeGroupsInOrder.push({ bridge: genericBridge, proxies: genericProxies, indexes: genericIndexes });
      // If there are no controller groups, ensure generic is still probed (already added). If targets were empty, skip.
      try {
        for (const group of bridgeGroupsInOrder) {
          if (!group.proxies.length) continue;
          const afterProbe = createAfterProbe(group.bridge);
          const groupResults = await probePoolProxies(group.proxies, group.bridge, {
            fetchImpl: ctx?.probeFetch,
            bridgeFetch,
            clashQueue: clashProbeQueue,
            concurrency: 12,
            fastController: true,
            verifyEgressCount: Math.max(1, group.proxies.length),
            verifyProxyIds: s.accounts
              .map((account) => account.proxyId)
              .filter((id): id is string => Boolean(id)),
            checkpoint: () => batchProbeControl.checkpoint(),
            signal: batchProbeControl.signal(),
            afterProbe,
            onResult: async (result) => { await handleGroupResult(result); },
            onStageProgress: (stage, completed, total) => {
              batchProbeProgress.stage = stage;
              batchProbeProgress.stageCompleted = completed;
              batchProbeProgress.stageTotal = total;
              batchProbeProgress.updatedAt = new Date().toISOString();
            },
          });
          for (let gi = 0; gi < groupResults.length; gi++) {
            const targetIndex = group.indexes[gi];
            // probePoolProxies returns in input order; align by position, but fallback to id lookup if order shifted due to filtering
            const res = groupResults[gi];
            if (res) indexedResults[targetIndex] = res.anonymousZen === undefined ? attachAnonymousZenResult(res, null) : res;
          }
          // Handle any fast-screened controller nodes that kept delay-only results but were not yet reported via onResult (they are still in groupResults)
          // Our handleGroupResult already covered all via onResult, so no extra handling needed.
          if (batchProbeControl.isCancelled()) break;
        }
        // Any groups not yet filled (e.g., filtered controller delay nodes) — ensure they appear in indexedResults
        // probePoolProxies already called onResult for each completed, but ensure indexedResults is complete
        results = indexedResults.filter((result): result is ProbeResult => Boolean(result));
        // Fallback: if for some reason results length mismatches targets, ensure anonymousZen field present
        results = results.map((result) => result.anonymousZen === undefined ? attachAnonymousZenResult(result, null) : result);
      } catch (err) {
        probeError = err;
        throw err;
      }
    } catch (err) {
      probeError = err;
    } finally {
      for (const [bridgeId, entry] of controllerGroups) {
        const node = previousNodes.get(bridgeId);
        if (node) {
          await clashProbeQueue
            .run(() => selectClashProxy(entry.bridge, node, bridgeFetch))
            .catch(() => undefined);
        }
      }
      if (genericPreviousNode) {
        await clashProbeQueue
          .run(() => selectClashProxy(genericBridge, genericPreviousNode, bridgeFetch))
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
      await persistProbeState(ctx);
      throw finalError;
    }
    await workerSyncChain;
    return finishBatchProbe({
      res, store, upstream, probes, results, targets, batchProbeProgress,
      workerSyncError, incrementallyAddedWorkerIds,
      cancelled: batchProbeControl.isCancelled(), probeState: ctx.probeState,
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
  probeState: RequestContext["probeState"];
}): Promise<boolean> {
  const {
    res, store, upstream, probes, results, targets, batchProbeProgress,
    workerSyncError, incrementallyAddedWorkerIds, cancelled, probeState,
  } = args;
  if (workerSyncError) {
    const message = workerSyncError instanceof Error ? workerSyncError.message : String(workerSyncError);
    const finishedAt = new Date().toISOString();
    Object.assign(batchProbeProgress, { running: false, updatedAt: finishedAt, finishedAt, error: message });
    await probeState.save(probes.getAll(), batchProbeProgress);
    throw workerSyncError;
  }
  probes.setMany(results);
  const synced = syncAnonymousWorkers(store.get(), results);
  let saved: GatewaySettings;
  try {
    saved = await store.save({
      proxyPool: applyProbeEgressIps(store.get().proxyPool, results),
      ...(synced.addedIds.length ? { accounts: synced.accounts } : {}),
    });
  } catch (error) {
    const failedAt = new Date().toISOString();
    Object.assign(batchProbeProgress, {
      running: false,
      updatedAt: failedAt,
      finishedAt: failedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    await probeState.save(probes.getAll(), batchProbeProgress);
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
  await probeState.save(probes.getAll(), batchProbeProgress);
  logBatchSummary(results, cancelled);
  // The batch state is already persisted above; if the browser disconnected
  // mid-run, skip the final write (it would throw on a dead socket) — the
  // client recovers via test-batch/status polling.
  if (!res.writableEnded && !res.destroyed) {
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
  }
  return true;
}
