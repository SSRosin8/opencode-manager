/**
 * Proxy pool latency / reachability probes (direct HTTP/SOCKS + Clash-bridged nodes).
 */

import { fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";
import type { AccountProxy } from "../relay/accounts.js";
import {
  isClashProtocol,
  type ClashBridgeConfig,
  type PoolProxy,
  resolveAccountEgress,
} from "./pool.js";
import { createProxyDispatcher } from "./dispatcher.js";
import {
  ClashSwitchQueue,
  probeClashNodeDelay,
  selectClashProxy,
} from "./clashBridge.js";

/** Echo the public egress IP so health checks can also verify account isolation. */
export const DEFAULT_PROBE_URL = "https://api.ipify.org";
export const DEFAULT_PROBE_TIMEOUT_MS = 8000;

export type ProbeHealth = "healthy" | "warn" | "bad" | "testing" | "skip";

export type ProbeResult = {
  id: string;
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
  testedAt: string;
  health: ProbeHealth;
  egressIp?: string | null;
  skipped?: boolean;
  reason?: string;
};

export type ProbeFetch = (
  url: string,
  init: RequestInit & { dispatcher?: unknown; signal?: AbortSignal }
) => Promise<Response>;

export type ProbeOptions = {
  probeUrl?: string;
  timeoutMs?: number;
  fetchImpl?: ProbeFetch;
  bridgeFetch?: typeof fetch;
  clashQueue?: ClashSwitchQueue;
  /** Concurrency for direct (non-bridge) nodes in batch mode. */
  concurrency?: number;
  /** Use Mihomo's per-node delay API for Controller imports. */
  fastController?: boolean;
  /** Full public-IP checks to run after fast Controller screening. */
  verifyEgressCount?: number;
  /** Controller proxy ids that should receive full public-IP verification first. */
  verifyProxyIds?: string[];
};

/** In-memory last probe results (process lifetime). */
export class ProbeResultCache {
  private map = new Map<string, ProbeResult>();

  get(id: string): ProbeResult | undefined {
    return this.map.get(id);
  }

  set(result: ProbeResult): void {
    this.map.set(result.id, result);
  }

  setMany(results: ProbeResult[]): void {
    for (const r of results) this.map.set(r.id, r);
  }

  getAll(): Record<string, ProbeResult> {
    const out: Record<string, ProbeResult> = {};
    for (const [k, v] of this.map) out[k] = v;
    return out;
  }

  delete(id: string): void {
    this.map.delete(id);
  }

  clear(): void {
    this.map.clear();
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function needsBridgeEgress(proxy: PoolProxy): boolean {
  if (proxy.usable) return false;
  return Boolean(proxy.bridgeable || isClashProtocol(proxy.type));
}

function skipResult(
  id: string,
  health: ProbeHealth,
  reason: string,
  error: string
): ProbeResult {
  return {
    id,
    ok: false,
    latencyMs: null,
    error,
    testedAt: nowIso(),
    health,
    skipped: true,
    reason,
  };
}

async function timedProxyFetch(
  url: string,
  proxy: NonNullable<AccountProxy>,
  opts: {
    timeoutMs: number;
    fetchImpl: ProbeFetch;
  }
): Promise<{ latencyMs: number; status: number; egressIp: string | null }> {
  const dispatcher = createProxyDispatcher(proxy);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs);
  const t0 = performance.now();
  try {
    const res = await opts.fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      signal: ac.signal,
      dispatcher,
      headers: { "User-Agent": "OCFreeRelay-probe/1.0", Accept: "*/*" },
    });
    let body = "";
    try {
      body = (await res.text()).trim();
    } catch {
      /* body is optional */
    }
    const ip = body.match(/^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f:]+)$/i)?.[0] ?? null;
    return {
      latencyMs: Math.round(performance.now() - t0),
      status: res.status,
      egressIp: ip,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe one pool node: measure RTT through its resolved egress.
 * Bridge nodes switch Clash selector first (serialized when clashQueue is shared).
 */
export async function probePoolProxy(
  proxy: PoolProxy,
  bridge: ClashBridgeConfig,
  opts: ProbeOptions = {}
): Promise<ProbeResult> {
  const id = proxy.id;
  const testedAt = nowIso();
  const probeUrl = opts.probeUrl ?? DEFAULT_PROBE_URL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const fetchImpl: ProbeFetch =
    opts.fetchImpl ??
    ((url, init) =>
      undiciFetch(url, init as UndiciRequestInit) as unknown as Promise<Response>);
  const bridgeFetch = opts.bridgeFetch ?? globalThis.fetch;

  if (!proxy.enabled) {
    return skipResult(id, "bad", "disabled", "disabled");
  }

  if (!proxy.usable && !needsBridgeEgress(proxy)) {
    return skipResult(id, "bad", "unusable", "unusable protocol");
  }

  if (needsBridgeEgress(proxy) && !bridge?.enabled) {
    return skipResult(id, "warn", "bridge_required", "Clash bridge required");
  }

  const egress = resolveAccountEgress({ proxyId: proxy.id }, [proxy], bridge);
  if (!egress.proxy) {
    return skipResult(id, "bad", "no_egress", "no proxy egress");
  }

  const run = async (): Promise<ProbeResult> => {
    try {
      if (egress.clashNodeName && bridge.enabled) {
        await selectClashProxy(bridge, egress.clashNodeName, bridgeFetch);
      }
      const { latencyMs, status, egressIp } = await timedProxyFetch(probeUrl, egress.proxy!, {
        timeoutMs,
        fetchImpl,
      });
      if (status === 407) {
        return {
          id,
          ok: false,
          latencyMs,
          error: "proxy auth required (407)",
          testedAt,
          health: "bad",
        };
      }
      // Any other HTTP response means the tunnel worked (204/200/301/…).
      return {
        id,
        ok: true,
        latencyMs,
        error: null,
        testedAt,
        health: "healthy",
        egressIp,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = /abort|timeout/i.test(msg);
      return {
        id,
        ok: false,
        latencyMs: null,
        error: isTimeout ? "Timeout" : msg,
        testedAt: nowIso(),
        health: "bad",
      };
    }
  };

  if (egress.clashNodeName && opts.clashQueue) {
    return opts.clashQueue.run(run);
  }
  return run();
}

/**
 * Batch probe. Direct nodes run with limited concurrency; Clash-bridged nodes
 * are serialized via ClashSwitchQueue so selector switches do not race.
 */
export async function probePoolProxies(
  proxies: PoolProxy[],
  bridge: ClashBridgeConfig,
  opts: ProbeOptions = {}
): Promise<ProbeResult[]> {
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const clashQueue = opts.clashQueue ?? new ClashSwitchQueue();
  const results: ProbeResult[] = new Array(proxies.length);

  const direct: Array<{ i: number; p: PoolProxy }> = [];
  const bridged: Array<{ i: number; p: PoolProxy }> = [];
  const controllerNodes: Array<{ i: number; p: PoolProxy }> = [];
  const skipped: Array<{ i: number; p: PoolProxy }> = [];

  for (let i = 0; i < proxies.length; i++) {
    const p = proxies[i];
    if (!p.enabled) {
      skipped.push({ i, p });
    } else if (p.usable) {
      direct.push({ i, p });
    } else if (opts.fastController && p.source === "controller" && bridge?.enabled) {
      controllerNodes.push({ i, p });
    } else if (needsBridgeEgress(p) && bridge?.enabled) {
      bridged.push({ i, p });
    } else {
      skipped.push({ i, p });
    }
  }

  await Promise.all(
    skipped.map(async ({ i, p }) => {
      results[i] = await probePoolProxy(p, bridge, { ...opts, clashQueue });
    })
  );

  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, direct.length)) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= direct.length) return;
      const { i, p } = direct[idx];
      results[i] = await probePoolProxy(p, bridge, { ...opts, clashQueue });
    }
  });
  if (direct.length) await Promise.all(workers);

  let controllerCursor = 0;
  const controllerConcurrency = Math.min(16, Math.max(1, controllerNodes.length));
  const controllerWorkers = Array.from({ length: controllerConcurrency }, async () => {
    while (true) {
      const idx = controllerCursor++;
      if (idx >= controllerNodes.length) return;
      const { i, p } = controllerNodes[idx];
      const testedAt = nowIso();
      try {
        const latencyMs = await probeClashNodeDelay(
          bridge,
          p.clashNodeName || p.name,
          Math.min(opts.timeoutMs ?? 3500, 3500),
          opts.bridgeFetch ?? globalThis.fetch
        );
        results[i] = {
          id: p.id,
          ok: true,
          latencyMs,
          error: null,
          testedAt,
          health: "healthy",
          egressIp: null,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results[i] = {
          id: p.id,
          ok: false,
          latencyMs: null,
          error: /abort|timeout/i.test(message) ? "Timeout" : message,
          testedAt,
          health: "bad",
          egressIp: null,
        };
      }
    }
  });
  if (controllerNodes.length) await Promise.all(controllerWorkers);

  const verifyCount = Math.max(0, opts.verifyEgressCount ?? 0);
  if (verifyCount && controllerNodes.length) {
    const priority = new Set(opts.verifyProxyIds ?? []);
    const candidates = controllerNodes
      .filter(({ i }) => results[i]?.ok)
      .sort(({ i: a, p: pa }, { i: b, p: pb }) => {
        const priorityDiff = Number(priority.has(pb.id)) - Number(priority.has(pa.id));
        if (priorityDiff) return priorityDiff;
        return (results[a].latencyMs ?? Infinity) - (results[b].latencyMs ?? Infinity);
      });
    const uniqueIps = new Set<string>();
    for (const { i, p } of candidates) {
      const full = await probePoolProxy(p, bridge, { ...opts, fastController: false, clashQueue });
      results[i] = full;
      if (full.ok && full.egressIp) uniqueIps.add(full.egressIp);
      if (uniqueIps.size >= verifyCount) break;
    }
  }

  for (const { i, p } of bridged) {
    results[i] = await probePoolProxy(p, bridge, { ...opts, clashQueue });
  }

  return results;
}

export function summarizeProbeResults(results: ProbeResult[]): {
  total: number;
  ok: number;
  fail: number;
  skip: number;
} {
  let ok = 0;
  let fail = 0;
  let skip = 0;
  for (const r of results) {
    if (r.skipped) skip += 1;
    else if (r.ok) ok += 1;
    else fail += 1;
  }
  return { total: results.length, ok, fail, skip };
}
