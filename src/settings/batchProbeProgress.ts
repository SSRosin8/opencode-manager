/**
 * Batch probe progress: short-lived task state persisted separately from
 * GatewaySettings so UI refresh can resume display and restarts mark
 * in-flight batches as interrupted.
 */

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
