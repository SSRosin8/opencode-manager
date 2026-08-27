import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newBatchProbeProgress } from "../src/server/context.js";
import { close, createApp, listen, type App } from "../src/server/http.js";
import { ProbeStateStore } from "../src/settings/probeState.js";
import { SettingsStore } from "../src/settings/store.js";

describe("probe state persistence", () => {
  let dir: string | null = null;
  let app: App | null = null;

  afterEach(async () => {
    if (app) await close(app);
    app = null;
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it("stores only bounded, sanitized probe diagnostics", async () => {
    dir = await mkdtemp(join(tmpdir(), "opencode-manager-probe-state-"));
    const settingsPath = join(dir, "settings.json");
    const state = new ProbeStateStore(settingsPath);
    const progress = newBatchProbeProgress();
    await state.save([{
      id: "proxy-a",
      ok: false,
      latencyMs: null,
      error: "connect https://user:secret@example.invalid/private failed\nwith details",
      testedAt: "2026-08-27T01:00:00.000Z",
      health: "bad",
      anonymousZen: {
        id: "proxy-a",
        status: "blocked",
        reasonCode: "forbidden",
        ok: false,
        httpStatus: 403,
        latencyMs: 25,
        error: "response included sk-fake-secret-token",
        testedAt: "2026-08-27T01:00:01.000Z",
      },
    }], progress);

    const raw = await readFile(join(dir, "probe-state.json"), "utf8");
    expect(raw).not.toContain("secret");
    expect(raw).not.toContain("example.invalid");
    expect(JSON.parse(raw).probeResults[0]).toMatchObject({
      id: "proxy-a",
      error: "Probe failed",
      anonymousZen: {
        status: "blocked",
        reasonCode: "forbidden",
        httpStatus: 403,
        error: "Probe failed",
      },
    });
  });

  it("restores legacy HTTP 5xx results with an upstream failure reason", async () => {
    dir = await mkdtemp(join(tmpdir(), "opencode-manager-probe-state-"));
    const state = new ProbeStateStore(join(dir, "settings.json"));
    await state.save([{
      id: "proxy-a", ok: true, latencyMs: 20, error: null,
      testedAt: "2026-08-27T01:00:00.000Z", health: "warn",
      anonymousZen: {
        id: "proxy-a", status: "temporary_failure", ok: false,
        httpStatus: 503, latencyMs: 40, error: "Endpoint is unavailable",
        testedAt: "2026-08-27T01:00:00.000Z",
      },
    }], newBatchProbeProgress());

    const restored = await state.load(new Set(["proxy-a"]), newBatchProbeProgress());
    expect(restored.probeResults[0]?.anonymousZen?.reasonCode).toBe("upstream_failure");
  });

  it("restores results and marks an active batch interrupted on app restart", async () => {
    dir = await mkdtemp(join(tmpdir(), "opencode-manager-probe-restart-"));
    const settingsPath = join(dir, "settings.json");
    const settings = new SettingsStore(settingsPath);
    await settings.save({
      accounts: [],
      proxyPool: [{
        id: "proxy-a", name: "proxy-a", type: "http", host: "192.0.2.10", port: 8080,
        enabled: true, source: "manual", usable: true, bridgeable: true,
      }],
    });
    const progress = {
      ...newBatchProbeProgress(),
      running: true,
      total: 2,
      completed: 1,
      completedIds: ["proxy-a", "removed-proxy"],
      startedAt: "2026-08-27T01:00:00.000Z",
      updatedAt: "2026-08-27T01:00:01.000Z",
    };
    await new ProbeStateStore(settingsPath).save([{
      id: "proxy-a", ok: true, latencyMs: 42, error: null,
      testedAt: "2026-08-27T01:00:01.000Z", health: "healthy", egressIp: "203.0.113.10",
    }, {
      id: "removed-proxy", ok: true, latencyMs: 10, error: null,
      testedAt: "2026-08-27T01:00:01.000Z", health: "healthy", egressIp: "203.0.113.11",
    }], progress);

    app = await createApp({ store: new SettingsStore(settingsPath), port: 0 });
    await listen(app);
    expect(app.probes.getAll()).toEqual({
      "proxy-a": expect.objectContaining({ latencyMs: 42, egressIp: "203.0.113.10" }),
    });
    const persisted = await new ProbeStateStore(settingsPath).load(
      new Set(["proxy-a"]), newBatchProbeProgress()
    );
    expect(persisted.batchProbe).toMatchObject({
      running: false,
      paused: false,
      completed: 1,
      completedIds: ["proxy-a"],
      error: "Interrupted by service restart",
    });
    expect(persisted.batchProbe.finishedAt).toBeTruthy();
  });

});
