import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestContext } from "../context.js";
import { assignHealthyProxiesToWorkers } from "../../proxy/pool.js";
import type { GatewaySettings } from "../../settings/store.js";
import { duplicateWorkerEgress } from "../workerEgress.js";
import { readBody, sendJson } from "../httpIO.js";

export async function handleWorkersAdmin(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: RequestContext
): Promise<boolean> {
  const { store, upstream, probes, workerStats, batchProbeProgress } = ctx;
  // PATCH /admin/api/workers/:id — enable or disable one configured worker.
  if (method === "PATCH" && path.match(/^\/admin\/api\/workers\/[^/]+$/)) {
    if (batchProbeProgress.running) {
      sendJson(res, 409, {
        error: { message: "Workers cannot be changed while a batch proxy test is running", type: "batch_probe_running" },
      });
      return true;
    }
    const id = decodeURIComponent(path.slice("/admin/api/workers/".length));
    const raw = await readBody(req);
    let enabled: boolean;
    try {
      const body = JSON.parse(raw.toString("utf8") || "{}") as { enabled?: unknown };
      if (typeof body.enabled !== "boolean") throw new Error("enabled must be boolean");
      enabled = body.enabled;
    } catch (error) {
      sendJson(res, 400, {
        error: { message: error instanceof Error ? error.message : "Invalid JSON" },
      });
      return true;
    }
    const current = store.get();
    const index = current.accounts.findIndex((account) => account.id === id);
    if (index < 0) {
      sendJson(res, 404, { error: { message: `Worker not found: ${id}` } });
      return true;
    }
    const accounts = current.accounts.map((account, accountIndex) =>
      accountIndex === index ? { ...account, enabled } : account
    );
    const duplicate = enabled ? duplicateWorkerEgress(accounts, probes) : null;
    if (duplicate) {
      sendJson(res, 400, {
        error: {
          type: "duplicate_worker_egress",
          message: `${duplicate.kind} workers ${duplicate.accountIds.join(", ")} share ${duplicate.route}`,
        },
      });
      return true;
    }
    const saved = await store.save({ accounts });
    upstream.updateSettings(saved);
    store.updateReadyCount(
      upstream.rotator.readyCount(),
      upstream.rotator.getAccounts().length
    );
    sendJson(res, 200, {
      ok: true,
      worker: saved.accounts[index],
      routingStrategy: saved.routingStrategy,
    });
    return true;
  }

  // POST /admin/api/worker-stats/reset — clear all or one worker
  if (method === "POST" && path === "/admin/api/worker-stats/reset") {
    const raw = await readBody(req);
    let accountId: string | undefined;
    if (raw.length) {
      try {
        const body = JSON.parse(raw.toString("utf8") || "{}") as { accountId?: unknown };
        if (typeof body.accountId === "string" && body.accountId) accountId = body.accountId;
      } catch {
        sendJson(res, 400, { error: { message: "Invalid JSON" } });
        return true;
      }
    }
    await workerStats.reset(accountId);
    const accountIds = store.get().accounts.map((a) => a.id);
    sendJson(res, 200, {
      ok: true,
      workers: workerStats.listForAccounts(accountIds),
      usageTotals: workerStats.totals(accountIds),
    });
    return true;
  }

  // POST /admin/api/workers/assign-proxies — bind each worker to a unique probe-healthy proxy
  if (method === "POST" && path === "/admin/api/workers/assign-proxies") {
    if (batchProbeProgress.running) {
      sendJson(res, 409, {
        error: { message: "Workers cannot be assigned while a batch proxy test is running", type: "batch_probe_running" },
      });
      return true;
    }
    const s = store.get();
    const raw = await readBody(req);
    let accounts = s.accounts;
    if (raw.length) {
      try {
        const body = JSON.parse(raw.toString("utf8") || "{}") as {
          accounts?: GatewaySettings["accounts"];
        };
        if (Array.isArray(body.accounts) && body.accounts.length) {
          accounts = body.accounts;
        }
      } catch {
        sendJson(res, 400, { error: { message: "Invalid JSON" } });
        return true;
      }
    }

    const result = assignHealthyProxiesToWorkers({
      accounts,
      pool: s.proxyPool,
      probeResults: probes.getAll(),
      bridge: s.clashBridge,
    });

    if (result.healthyAvailable === 0) {
      sendJson(res, 400, {
        error: {
          message:
            "No healthy proxies in the pool. Run Batch Test first, then assign again.",
        },
        healthyAvailable: 0,
        assigned: 0,
        unassigned: accounts.length,
      });
      return true;
    }

    const saved = await store.save({ accounts: result.accounts });
    upstream.updateSettings(saved);
    store.updateReadyCount(
      upstream.rotator.readyCount(),
      upstream.rotator.getAccounts().length
    );
    sendJson(res, 200, {
      ok: true,
      settings: saved,
      assigned: result.assigned,
      unassigned: result.unassigned,
      healthyAvailable: result.healthyAvailable,
      assignments: result.assignments,
    });
    return true;
  }



  return false;
}
