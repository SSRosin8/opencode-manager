import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { WorkerAttemptRecord, WorkerStatSnapshot } from "./workerStats.js";

export type WorkerStatsPersistShape = {
  workers: Record<
    string,
    Omit<WorkerStatSnapshot, "accountId" | "cacheRate" | "distinctModelCount">
  >;
  attempts?: WorkerAttemptRecord[];
};

export function defaultWorkerStatsPath(): string {
  return resolve(process.cwd(), "data", "worker-stats.json");
}

export type WorkerStatsWriter = (
  path: string,
  data: string,
  encoding: "utf8"
) => Promise<void>;

/** Serializes stats writes so an older snapshot can never finish after a newer one. */
export class WorkerStatsPersistence {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly enabled: boolean,
    private readonly writer: WorkerStatsWriter = (path, data, encoding) =>
      writeFile(path, data, encoding)
  ) {}

  enqueue(payload: string): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    const write = async (): Promise<void> => {
      await mkdir(dirname(this.path), { recursive: true });
      await this.writer(this.path, payload, "utf8");
    };
    const pending = this.queue.then(write);
    // A failed write must not prevent a later snapshot from being persisted.
    this.queue = pending.catch(() => {});
    return pending;
  }
}
