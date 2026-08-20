import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { ADMIN_CLIENT_BATCH } from "../src/server/admin/clientBatch.js";

interface BatchProgress {
  running: boolean;
  paused?: boolean;
  cancelRequested?: boolean;
  cancelled?: boolean;
  total: number;
  completed: number;
  completedIds: string[];
  addedWorkerIds: string[];
  startedAt: string;
  updatedAt: string;
}

interface BatchHarnessState {
  batchProgress: BatchProgress | null;
  batchTesting: boolean;
}

interface BatchHarnessApi {
  batchTestProxies(): Promise<void>;
  pollBatchProgress(generation?: number): Promise<void>;
  controlBatchTest(action: "pause" | "resume" | "cancel"): Promise<void>;
  getState(): BatchHarnessState;
  getButton(id: string): { disabled: boolean; hidden: boolean; textContent: string };
  stubReload(callback: () => Promise<void>): void;
}

function progress(overrides: Partial<BatchProgress> = {}): BatchProgress {
  return {
    running: true,
    total: 2,
    completed: 0,
    completedIds: [],
    addedWorkerIds: [],
    startedAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:01.000Z",
    ...overrides,
  };
}

function createBatchHarness(responses: BatchProgress[], options: {
  batchTesting?: boolean;
  batchRequestActive?: boolean;
  batchProgressSeenRunning?: boolean;
} = {}) {
  const renderMetrics = vi.fn();
  const renderIsolation = vi.fn();
  const renderAll = vi.fn();
  const renderNodes = vi.fn();
  const patchBatchWorkerMetrics = vi.fn();
  const loadStatus = vi.fn(async () => undefined);
  const reload = vi.fn(async () => undefined);
  const buttons = new Map<string, { disabled: boolean; hidden: boolean; textContent: string }>();
  let responseIndex = 0;

  const fetchMock = vi.fn(async (url: string) => {
    const next = responses[Math.min(responseIndex, responses.length - 1)];
    if (url.includes("/test-batch/")) {
      return { ok: true, json: async () => ({ progress: next }) };
    }
    if (url.endsWith("/test-batch")) {
      return {
        ok: true,
        json: async () => ({
          progress: next,
          probeResults: {},
          results: [],
          summary: { ok: 0, fail: 0, skip: 0 },
          autoWorkers: { added: 0, addedIds: [] },
        }),
      };
    }
    responseIndex += 1;
    return {
      ok: true,
      json: async () => ({ batchProbe: next, probeResults: {} }),
    };
  });
  const context = {
    AbortController,
    Array,
    Set,
    clearTimeout,
    setTimeout,
    batchProgressAbort: null,
    batchProgressTimer: null,
    batchPollGeneration: 1,
    batchProgress: null,
    batchTesting: options.batchTesting ?? true,
    batchProgressSeenRunning: options.batchProgressSeenRunning ?? true,
    batchRequestActive: options.batchRequestActive ?? true,
    batchControlPending: false,
    lastBatchPatchedWorkerCount: 0,
    batchBaselineAccountIds: new Set<string>(),
    probeResults: {},
    serverAccountIds: new Set<string>(),
    settings: {
      accounts: [],
      proxyPool: [{ id: "proxy-a" }, { id: "proxy-b" }],
    },
    testingIds: new Set(["proxy-a", "proxy-b"]),
    document: {
      activeElement: null,
      querySelectorAll: () => [],
    },
    fetch: fetchMock,
    renderMetrics,
    renderIsolation,
    renderAll,
    renderNodes,
    patchBatchWorkerMetrics,
    loadStatus,
    renderUnassigned: vi.fn(),
    renderAccounts: vi.fn(),
    renderStatusChrome: vi.fn(),
    renderActivity: vi.fn(),
    pushProbeEvent: vi.fn(),
    $: (id: string) => {
      let button = buttons.get(id);
      if (!button) {
        button = { disabled: false, hidden: false, textContent: "" };
        buttons.set(id, button);
      }
      return button;
    },
    t: (key: string) => {
      if (key === "batchProgress" || key === "batchScreening") {
        return (completed: number, total: number) => `${completed}/${total}`;
      }
      if (key === "batchPaused") return (completed: number, total: number) => `paused ${completed}/${total}`;
      if (key === "toastBatchDone") return () => "done";
      if (key === "toastBatchWorkers") return () => "workers";
      if (key === "toastBatchCancelled") return () => "cancelled";
      return key;
    },
    toast: vi.fn(),
  };

  vm.runInNewContext(`${ADMIN_CLIENT_BATCH}\n    globalThis.__batchHarness = {
      batchTestProxies,
      pollBatchProgress,
      controlBatchTest,
      getState: () => ({ batchProgress, batchTesting }),
      getButton: (id) => $(id),
      stubReload: (callback) => { reloadAfterBatchPreservingDrafts = callback; },
    };`, context);

  const api = (context as typeof context & { __batchHarness: BatchHarnessApi }).__batchHarness;
  api.stubReload(reload);
  return { api, fetchMock, loadStatus, patchBatchWorkerMetrics, reload, renderAll, renderIsolation, renderMetrics, renderNodes };
}

describe("admin batch progress rendering", () => {
  it("does not rebuild overview or proxy summary views during running polls", async () => {
    const first = progress();
    const withWorker = progress({
      addedWorkerIds: ["anonymous-zen-proxy-a"],
      updatedAt: "2026-08-20T00:00:02.000Z",
    });
    const harness = createBatchHarness([first, withWorker]);

    await harness.api.pollBatchProgress(1);
    await harness.api.pollBatchProgress(1);
    await harness.api.pollBatchProgress(1);

    expect(harness.api.getState()).toMatchObject({
      batchProgress: withWorker,
      batchTesting: true,
    });
    expect(harness.reload).not.toHaveBeenCalled();
    expect(harness.renderMetrics).not.toHaveBeenCalled();
    expect(harness.renderIsolation).not.toHaveBeenCalled();
    expect(harness.renderAll).not.toHaveBeenCalled();
    expect(harness.renderNodes).toHaveBeenCalledTimes(1);
    expect(harness.fetchMock).toHaveBeenCalledWith("/admin/api/status", { cache: "no-store" });
    expect(harness.patchBatchWorkerMetrics).toHaveBeenCalledTimes(1);
  });

  it("performs one unified full render when polling observes completion", async () => {
    const finished = progress({
      running: false,
      completed: 2,
      completedIds: ["proxy-a", "proxy-b"],
      updatedAt: "2026-08-20T00:00:03.000Z",
    });
    const harness = createBatchHarness([finished], {
      batchRequestActive: false,
      batchProgressSeenRunning: true,
    });

    await harness.api.pollBatchProgress(1);

    expect(harness.api.getState()).toMatchObject({
      batchProgress: finished,
      batchTesting: false,
    });
    expect(harness.reload).toHaveBeenCalledTimes(1);
    expect(harness.reload).toHaveBeenCalledWith();
    expect(harness.renderMetrics).not.toHaveBeenCalled();
    expect(harness.renderIsolation).not.toHaveBeenCalled();
    expect(harness.renderAll).toHaveBeenCalledTimes(1);
  });

  it("renders once when the batch POST returns its terminal response", async () => {
    const finished = progress({
      running: false,
      completed: 2,
      completedIds: ["proxy-a", "proxy-b"],
      updatedAt: "2026-08-20T00:00:03.000Z",
    });
    const harness = createBatchHarness([finished], { batchTesting: false });

    await harness.api.batchTestProxies();

    expect(harness.reload).toHaveBeenCalledTimes(1);
    expect(harness.renderAll).toHaveBeenCalledTimes(1);
  });

  it.each(["pause", "resume", "cancel"] as const)("sends the %s batch control request", async (action) => {
    const next = progress({
      paused: action === "pause",
      cancelRequested: action === "cancel",
      updatedAt: "2026-08-20T00:00:04.000Z",
    });
    const harness = createBatchHarness([next]);

    await harness.api.pollBatchProgress(1);
    await harness.api.controlBatchTest(action);

    expect(harness.api.getState().batchProgress).toMatchObject(next);
    expect(harness.fetchMock).toHaveBeenCalledWith(
      "/admin/api/proxy-pool/test-batch/" + action,
      { method: "POST" },
    );
    const pause = harness.api.getButton("btn-batch-pause");
    const cancel = harness.api.getButton("btn-batch-cancel");
    expect(pause.hidden).toBe(action === "cancel");
    expect(pause.textContent).toBe(action === "pause" ? "resumeBatch" : "pauseBatch");
    expect(cancel.hidden).toBe(false);
    expect(cancel.disabled).toBe(action === "cancel");
  });
});
