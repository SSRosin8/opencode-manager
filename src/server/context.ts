import type { UpstreamClient } from "../proxy/upstream.js";
import type { ProbeFetch } from "../proxy/probe.js";
import { ProbeResultCache } from "../proxy/probe.js";
import { ClashSwitchQueue } from "../proxy/clashBridge.js";
import type { SettingsStore } from "../settings/store.js";
import type { WorkerStatsStore } from "../settings/workerStats.js";
import type { FreeModelRegistry } from "../proxy/freeModels.js";
import type { BatchProbeControl } from "./batchProbeControl.js";

export type BatchProbeProgress = {
  running: boolean;
  paused: boolean;
  cancelRequested: boolean;
  cancelled: boolean;
  total: number;
  completed: number;
  completedIds: string[];
  stage: "screening" | "verifying" | null;
  stageCompleted: number;
  stageTotal: number;
  addedWorkerIds: string[];
  startedAt: string | null;
  updatedAt: string | null;
  finishedAt: string | null;
  error: string | null;
};

export function newBatchProbeProgress(): BatchProbeProgress {
  return {
    running: false, paused: false, cancelRequested: false, cancelled: false,
    total: 0, completed: 0, completedIds: [], stage: null,
    stageCompleted: 0, stageTotal: 0, addedWorkerIds: [], startedAt: null,
    updatedAt: null, finishedAt: null, error: null,
  };
}

export function batchProbeSnapshot(progress: BatchProbeProgress): BatchProbeProgress {
  return {
    ...progress,
    completedIds: [...progress.completedIds],
    addedWorkerIds: [...progress.addedWorkerIds],
  };
}

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
};
