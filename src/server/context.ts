import type { UpstreamClient } from "../proxy/upstream.js";
import type { ProbeFetch } from "../proxy/probe.js";
import { ProbeResultCache } from "../proxy/probe.js";
import { ClashSwitchQueue } from "../proxy/clashBridge.js";
import type { SettingsStore } from "../settings/store.js";
import type { WorkerStatsStore } from "../settings/workerStats.js";
import type { FreeModelRegistry } from "../proxy/freeModels.js";
import type { BatchProbeControl } from "./batchProbeControl.js";
import type { ProbeStateStore } from "../settings/probeState.js";
// Batch progress type lives in settings (persistence owner); re-exported here
// so existing handlers/tests keep importing from context.
import type { BatchProbeProgress } from "../settings/batchProbeProgress.js";
export type { BatchProbeProgress } from "../settings/batchProbeProgress.js";
export { batchProbeSnapshot, newBatchProbeProgress } from "../settings/batchProbeProgress.js";

export type RequestContext = {
  store: SettingsStore;
  upstream: UpstreamClient;
  subscriptionFetch?: typeof fetch;
  probeFetch?: ProbeFetch;
  probes: ProbeResultCache;
  clashProbeQueue: ClashSwitchQueue;
  workerStats: WorkerStatsStore;
  freeModels: FreeModelRegistry;
  batchProbeProgress: BatchProbeProgress;
  batchProbeControl: BatchProbeControl;
  probeState: ProbeStateStore;
};

export function persistProbeState(ctx: RequestContext): Promise<void> {
  return ctx.probeState.save(ctx.probes.getAll(), ctx.batchProbeProgress);
}
