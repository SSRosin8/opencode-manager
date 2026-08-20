import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestContext } from "../context.js";
import { importClashControllerNodes, probeClashBridge } from "../../proxy/clashBridge.js";
import {
  replaceControllerProxies,
  type ClashBridgeConfig,
  type PoolProxy,
} from "../../proxy/pool.js";
import { inferAccountKind, type AccountConfig } from "../../relay/index.js";
import type { GatewaySettings } from "../../settings/store.js";
import { readBody, sendJson } from "../httpIO.js";

const CLASH_BRIDGE_KEYS = new Set([
  "enabled", "apiBase", "apiSecret", "localProxyHost", "localProxyPort", "selectorGroup",
]);

type CacheMove = { oldId: string; newId: string | null };
type BindingConflict = {
  kind: string;
  proxyId: string;
  accountIds: string[];
  unboundAccountIds: string[];
};

function normalizedControllerBase(apiBase: string): string {
  return apiBase.trim().replace(/\/+$/, "");
}

function planControllerReplacement(
  current: GatewaySettings,
  bridge: ClashBridgeConfig,
  imported: PoolProxy[]
): {
  proxyPool: PoolProxy[];
  accounts: AccountConfig[];
  cacheMoves: CacheMove[];
  bindingConflicts: BindingConflict[];
} {
  const sameController =
    normalizedControllerBase(current.clashBridge.apiBase) ===
    normalizedControllerBase(bridge.apiBase);
  const previousById = new Map(
    current.proxyPool
      .filter((proxy) => proxy.source === "controller")
      .map((proxy) => [proxy.id, proxy] as const)
  );
  const importedByName = new Map(
    imported.map((proxy) => [proxy.clashNodeName || proxy.name, proxy] as const)
  );
  const cacheMoves = [...previousById.values()].map((previous) => ({
    oldId: previous.id,
    newId: sameController
      ? importedByName.get(previous.clashNodeName || previous.name)?.id ?? null
      : null,
  }));
  const proxyPool = replaceControllerProxies(current.proxyPool, imported);
  const liveIds = new Set(proxyPool.map((proxy) => proxy.id));
  let accounts = current.accounts.map((account) => {
    if (!account.proxyId || liveIds.has(account.proxyId)) return account;
    const previous = previousById.get(account.proxyId);
    const replacement = sameController && previous
      ? importedByName.get(previous.clashNodeName || previous.name)
      : null;
    return { ...account, proxyId: replacement?.id ?? null };
  });

  const importedIds = new Set(imported.map((proxy) => proxy.id));
  const firstBinding = new Map<string, string>();
  const conflictsByKey = new Map<string, BindingConflict>();
  accounts = accounts.map((account) => {
    if (account.enabled === false || !account.proxyId || !importedIds.has(account.proxyId)) {
      return account;
    }
    const kind = inferAccountKind(account);
    const key = `${kind}\0${account.proxyId}`;
    const firstId = firstBinding.get(key);
    if (!firstId) {
      firstBinding.set(key, account.id);
      return account;
    }
    const conflict = conflictsByKey.get(key) ?? {
      kind,
      proxyId: account.proxyId,
      accountIds: [firstId],
      unboundAccountIds: [],
    };
    conflict.accountIds.push(account.id);
    conflict.unboundAccountIds.push(account.id);
    conflictsByKey.set(key, conflict);
    return { ...account, proxyId: null };
  });

  return {
    proxyPool,
    accounts,
    cacheMoves,
    bindingConflicts: [...conflictsByKey.values()],
  };
}

export async function handleClashAdmin(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  ctx: RequestContext
): Promise<boolean> {
  const { store, upstream, subscriptionFetch } = ctx;
  if (method === "PATCH" && path === "/admin/api/clash-bridge") {
    if (ctx.batchProbeProgress.running) {
      sendJson(res, 409, {
        error: { message: "Clash bridge cannot be changed during a batch test", type: "batch_probe_running" },
      });
      return true;
    }
    const raw = await readBody(req);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw.toString("utf8") || "{}") as Record<string, unknown>;
    } catch {
      sendJson(res, 400, { error: { message: "Invalid JSON" } });
      return true;
    }
    const unexpected = Object.keys(body).filter((key) => !CLASH_BRIDGE_KEYS.has(key));
    if (unexpected.length) {
      sendJson(res, 400, {
        error: { type: "invalid_clash_bridge", message: `Unexpected fields: ${unexpected.join(", ")}` },
      });
      return true;
    }
    const saved = await store.save({
      clashBridge: { ...store.get().clashBridge, ...body },
    });
    upstream.updateSettings(saved);
    store.updateReadyCount(upstream.rotator.readyCount(), upstream.rotator.getAccounts().length);
    sendJson(res, 200, { clashBridge: saved.clashBridge, settings: saved });
    return true;
  }
  // POST /admin/api/clash-bridge/probe
  if (method === "POST" && path === "/admin/api/clash-bridge/probe") {
    const s = store.get();
    const raw = await readBody(req);
    let override: Partial<GatewaySettings["clashBridge"]> = {};
    if (raw.length) {
      try {
        override = JSON.parse(raw.toString("utf8") || "{}") as Partial<
          GatewaySettings["clashBridge"]
        >;
      } catch {
        /* ignore */
      }
    }
    const bridge = { ...s.clashBridge, ...override };
    const result = await probeClashBridge(bridge, subscriptionFetch ?? globalThis.fetch);
    sendJson(res, result.ok ? 200 : 502, { ...result, bridge });
    return true;
  }

  // POST /admin/api/clash-bridge/import
  // Save the submitted bridge config and import nodes already loaded by Mihomo/Clash.
  if (method === "POST" && path === "/admin/api/clash-bridge/import") {
    if (ctx.batchProbeProgress.running) {
      sendJson(res, 409, {
        error: {
          message: "Cannot import Controller nodes while a batch proxy test is running",
          type: "batch_probe_running",
        },
      });
      return true;
    }
    const s = store.get();
    const raw = await readBody(req);
    let override: Partial<GatewaySettings["clashBridge"]> = {};
    if (raw.length) {
      try {
        override = JSON.parse(raw.toString("utf8") || "{}") as Partial<
          GatewaySettings["clashBridge"]
        >;
      } catch {
        sendJson(res, 400, { error: { message: "invalid JSON body" } });
        return true;
      }
    }
    const bridge = { ...s.clashBridge, ...override };
    try {
      const result = await importClashControllerNodes(
        bridge,
        subscriptionFetch ?? globalThis.fetch
      );
      if (ctx.batchProbeProgress.running) {
        sendJson(res, 409, {
          error: {
            message: "Cannot import Controller nodes while a batch proxy test is running",
            type: "batch_probe_running",
          },
        });
        return true;
      }
      let cacheMoves: CacheMove[] = [];
      let bindingConflicts: BindingConflict[] = [];
      const saved = await store.update((current) => {
        const plan = planControllerReplacement(current, bridge, result.proxies);
        cacheMoves = plan.cacheMoves;
        bindingConflicts = plan.bindingConflicts;
        return {
          clashBridge: bridge,
          proxyPool: plan.proxyPool,
          accounts: plan.accounts,
        };
      });
      for (const move of cacheMoves) {
        if (move.newId) ctx.probes.remap(move.oldId, move.newId);
        else ctx.probes.delete(move.oldId);
      }
      upstream.updateSettings(saved);
      store.updateReadyCount(
        upstream.rotator.readyCount(),
        upstream.rotator.getAccounts().length
      );
      sendJson(res, 200, {
        imported: result.proxies.length,
        group: result.group,
        current: result.current,
        groups: result.groups,
        bindingConflicts,
        settings: saved,
        probeResults: ctx.probes.getAll(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 502, { error: { message: `Controller import failed: ${message}` } });
    }
    return true;
  }


  return false;
}
