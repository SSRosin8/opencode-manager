/**
 * Proxy pool latency / reachability probes (direct HTTP/SOCKS + Clash-bridged nodes).
 */

import { fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";
import { randomUUID } from "node:crypto";
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
import { buildChatCompletionsUrl, DEFAULT_BASE_URL } from "../relay/url.js";

/** Echo the public egress IP so health checks can also verify account isolation. */
export const DEFAULT_PROBE_URL = "https://api.ipify.org";
export const DEFAULT_PROBE_TIMEOUT_MS = 8000;
export const DEFAULT_ANONYMOUS_ZEN_MODEL = "big-pickle";
export const DEFAULT_ANONYMOUS_ZEN_TIMEOUT_MS = 45_000;

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
  /** Real anonymous Zen model check through this egress. */
  anonymousZen?: AnonymousZenProbeResult | null;
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
  /**
   * Optional follow-up that runs before a selected Clash node is released.
   * This lets batch callers reuse the same selector switch for egress and
   * upstream checks instead of switching to every node twice.
   */
  afterProbe?: (proxy: PoolProxy, result: ProbeResult) => Promise<ProbeResult>;
  /** Called once when each proxy reaches its final batch result. */
  onResult?: (result: ProbeResult, completed: number, total: number) => void | Promise<void>;
  /** Reports work inside Controller fast-screening before final probes complete. */
  onStageProgress?: (
    stage: "screening" | "verifying",
    completed: number,
    total: number
  ) => void | Promise<void>;
  /** Wait before claiming another batch item; false stops scheduling new work. */
  checkpoint?: () => Promise<boolean>;
  /** Cancels in-flight requests as well as work waiting in the Clash queue. */
  signal?: AbortSignal;
};

export type AnonymousZenProbeStatus =
  | "usable"
  | "rate_limited"
  | "blocked"
  | "temporary_failure"
  | "unreachable";

export type AnonymousZenProbeResult = {
  id: string;
  status: AnonymousZenProbeStatus;
  ok: boolean;
  httpStatus: number | null;
  latencyMs: number | null;
  error: string | null;
  testedAt: string;
  retryAfterSeconds?: number;
};

export type AnonymousZenProbeOptions = {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: ProbeFetch;
  bridgeFetch?: typeof fetch;
  clashQueue?: ClashSwitchQueue;
  /** The caller already selected and exclusively owns this Clash node. */
  skipClashSwitch?: boolean;
  signal?: AbortSignal;
};

const anonymousZenClashQueue = new ClashSwitchQueue();

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

  remap(oldId: string, newId: string): void {
    if (oldId === newId) return;
    const result = this.map.get(oldId);
    if (!result) return;
    const current = this.map.get(newId);
    if (!current || result.testedAt >= current.testedAt) {
      this.map.set(newId, { ...result, id: newId });
    }
    this.map.delete(oldId);
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
    signal?: AbortSignal;
  }
): Promise<{ latencyMs: number; status: number; egressIp: string | null }> {
  const dispatcher = createProxyDispatcher(proxy);
  const ac = new AbortController();
  const forwardAbort = () => ac.abort(opts.signal?.reason);
  if (opts.signal?.aborted) forwardAbort();
  else opts.signal?.addEventListener("abort", forwardAbort, { once: true });
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs);
  const t0 = performance.now();
  try {
    const res = await opts.fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      signal: ac.signal,
      dispatcher,
      headers: { "User-Agent": "opencode-manager-probe/1.0", Accept: "*/*" },
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
    opts.signal?.removeEventListener("abort", forwardAbort);
  }
}

function anonymousZenStatus(httpStatus: number): AnonymousZenProbeStatus {
  if (httpStatus >= 200 && httpStatus < 300) return "usable";
  if (httpStatus === 429) return "rate_limited";
  if (httpStatus === 401 || httpStatus === 403) return "blocked";
  if (httpStatus === 407) return "unreachable";
  return "temporary_failure";
}

function retryAfterSeconds(headers: Headers): number | undefined {
  const value = headers.get("retry-after")?.trim();
  if (!value) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Math.ceil(Number(value));
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return undefined;
  return Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

async function zenResponseError(response: Response): Promise<string> {
  let text = "";
  try {
    text = (await response.text()).trim();
  } catch {
    /* fall back to the HTTP status */
  }
  if (text) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object") {
        const record = parsed as Record<string, unknown>;
        const nested =
          record.error && typeof record.error === "object"
            ? (record.error as Record<string, unknown>)
            : null;
        const message =
          (typeof nested?.message === "string" && nested.message) ||
          (typeof record.error === "string" && record.error) ||
          (typeof record.message === "string" && record.message) ||
          (typeof record.detail === "string" && record.detail);
        if (message) return message.slice(0, 500);
      }
    } catch {
      /* keep the plain response body */
    }
    return text.replace(/\s+/g, " ").slice(0, 500);
  }
  return `Zen HTTP ${response.status}`;
}

/**
 * Send a real, minimal anonymous request through one proxy pool entry.
 * OpenCode's anonymous Zen mode uses the fixed `public` bearer credential.
 */
export async function probeAnonymousZenProxy(
  proxy: PoolProxy,
  bridge: ClashBridgeConfig,
  opts: AnonymousZenProbeOptions = {}
): Promise<AnonymousZenProbeResult> {
  const testedAt = nowIso();
  const unreachable = (error: string): AnonymousZenProbeResult => ({
    id: proxy.id,
    status: "unreachable",
    ok: false,
    httpStatus: null,
    latencyMs: null,
    error,
    testedAt,
  });

  if (!proxy.enabled) return unreachable("disabled");
  if (!proxy.usable && !needsBridgeEgress(proxy)) {
    return unreachable("unusable protocol");
  }
  if (needsBridgeEgress(proxy) && !bridge?.enabled) {
    return unreachable("Clash bridge required");
  }

  const egress = resolveAccountEgress({ proxyId: proxy.id }, [proxy], bridge);
  if (!egress.proxy) return unreachable("no proxy egress");

  const fetchImpl: ProbeFetch =
    opts.fetchImpl ??
    ((url, init) =>
      undiciFetch(url, init as UndiciRequestInit) as unknown as Promise<Response>);
  const bridgeFetch = opts.bridgeFetch ?? globalThis.fetch;
  const timeoutMs = Math.max(1, opts.timeoutMs ?? DEFAULT_ANONYMOUS_ZEN_TIMEOUT_MS);
  const url = buildChatCompletionsUrl(opts.baseUrl ?? DEFAULT_BASE_URL);
  const model = opts.model?.trim() || DEFAULT_ANONYMOUS_ZEN_MODEL;

  const run = async (): Promise<AnonymousZenProbeResult> => {
    opts.signal?.throwIfAborted();
    const started = performance.now();
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(opts.signal?.reason);
    if (opts.signal?.aborted) forwardAbort();
    else opts.signal?.addEventListener("abort", forwardAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      if (egress.clashNodeName && bridge.enabled && !opts.skipClashSwitch) {
        const abortableBridgeFetch = ((url: string, init?: RequestInit) =>
          bridgeFetch(url, { ...init, signal: controller.signal })) as typeof fetch;
        await selectClashProxy(bridge, egress.clashNodeName, abortableBridgeFetch);
      }
      const response = await fetchImpl(url, {
        method: "POST",
        signal: controller.signal,
        dispatcher: createProxyDispatcher(egress.proxy!),
        headers: {
          Authorization: "Bearer public",
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "opencode-cli/1.0.0",
          "x-opencode-client": "cli",
          "x-opencode-project": "default",
          "x-opencode-request": randomUUID(),
          "x-opencode-session": randomUUID(),
        },
        body: JSON.stringify({
          model,
          // One input token and one output token are sufficient to prove that
          // this IP can reach an anonymous Zen model.
          messages: [{ role: "user", content: "x" }],
          stream: false,
          max_tokens: 1,
        }),
      });
      const status = anonymousZenStatus(response.status);
      const result: AnonymousZenProbeResult = {
        id: proxy.id,
        status,
        ok: status === "usable",
        httpStatus: response.status,
        latencyMs: Math.round(performance.now() - started),
        error: status === "usable" ? null : await zenResponseError(response),
        testedAt,
      };
      const retryAfter = retryAfterSeconds(response.headers);
      if (retryAfter !== undefined) result.retryAfterSeconds = retryAfter;
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const timedOut =
        controller.signal.aborted ||
        (err instanceof Error && err.name === "AbortError") ||
        /abort|timeout/i.test(message);
      return {
        id: proxy.id,
        status: "unreachable",
        ok: false,
        httpStatus: null,
        latencyMs: Math.round(performance.now() - started),
        error: timedOut ? "Timeout" : message,
        testedAt,
      };
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", forwardAbort);
    }
  };

  if (egress.clashNodeName && !opts.skipClashSwitch) {
    return (opts.clashQueue ?? anonymousZenClashQueue).run(run);
  }
  return run();
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
      opts.signal?.throwIfAborted();
      if (egress.clashNodeName && bridge.enabled) {
        const abortableBridgeFetch = opts.signal
          ? ((input: string | URL | Request, init?: RequestInit) =>
              bridgeFetch(input, {
                ...init,
                signal: init?.signal
                  ? AbortSignal.any([init.signal, opts.signal!])
                  : opts.signal,
              })) as typeof fetch
          : bridgeFetch;
        await selectClashProxy(bridge, egress.clashNodeName, abortableBridgeFetch);
      }
      const { latencyMs, status, egressIp } = await timedProxyFetch(probeUrl, egress.proxy!, {
        timeoutMs,
        fetchImpl,
        signal: opts.signal,
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
      const result: ProbeResult = {
        id,
        ok: true,
        latencyMs,
        error: null,
        testedAt,
        health: "healthy",
        egressIp,
      };
      return opts.afterProbe ? await opts.afterProbe(proxy, result) : result;
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
  const concurrency = Math.max(1, opts.concurrency ?? 8);
  const clashQueue = opts.clashQueue ?? new ClashSwitchQueue();
  const results: Array<ProbeResult | undefined> = new Array(proxies.length);
  const finalizedIndexes = new Set<number>();
  let completed = 0;
  const report = async (i: number, result: ProbeResult): Promise<void> => {
    finalizedIndexes.add(i);
    completed += 1;
    await opts.onResult?.(result, completed, proxies.length);
  };
  let schedulingStopped = false;
  const mayContinue = async (): Promise<boolean> => {
    const proceed = opts.checkpoint ? await opts.checkpoint() : true;
    if (!proceed) schedulingStopped = true;
    return proceed;
  };
  const wasCancelled = (): boolean => Boolean(opts.signal?.aborted);

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
      if (!await mayContinue()) return;
      const result = await probePoolProxy(p, bridge, { ...opts, clashQueue });
      if (wasCancelled()) return;
      results[i] = result;
      await report(i, result);
    })
  );

  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, direct.length)) }, async () => {
    while (true) {
      if (!await mayContinue()) return;
      const idx = cursor++;
      if (idx >= direct.length) return;
      const { i, p } = direct[idx];
      const result = await probePoolProxy(p, bridge, { ...opts, clashQueue });
      if (wasCancelled()) return;
      results[i] = result;
      await report(i, result);
    }
  });
  if (direct.length) await Promise.all(workers);
  if (schedulingStopped || wasCancelled()) {
    return results.filter(
      (result, i): result is ProbeResult => finalizedIndexes.has(i) && Boolean(result)
    );
  }

  let controllerCursor = 0;
  let controllerScreened = 0;
  const controllerConcurrency = Math.min(16, Math.max(1, controllerNodes.length));
  const controllerWorkers = Array.from({ length: controllerConcurrency }, async () => {
    while (true) {
      if (!await mayContinue()) return;
      const idx = controllerCursor++;
      if (idx >= controllerNodes.length) return;
      const { i, p } = controllerNodes[idx];
      const testedAt = nowIso();
      try {
        const latencyMs = await probeClashNodeDelay(
          bridge,
          p.clashNodeName || p.name,
          Math.min(opts.timeoutMs ?? 3500, 3500),
          opts.bridgeFetch ?? globalThis.fetch,
          opts.signal
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
        if (wasCancelled()) return;
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
      controllerScreened += 1;
      await opts.onStageProgress?.("screening", controllerScreened, controllerNodes.length);
    }
  });
  if (controllerNodes.length) await Promise.all(controllerWorkers);
  if (schedulingStopped || wasCancelled()) {
    return results.filter(
      (result, i): result is ProbeResult => finalizedIndexes.has(i) && Boolean(result)
    );
  }

  const reportedControllerIndexes = new Set<number>();
  const reportController = async (i: number): Promise<void> => {
    if (reportedControllerIndexes.has(i)) return;
    const result = results[i];
    if (!result) return;
    reportedControllerIndexes.add(i);
    await report(i, result);
  };
  await opts.onStageProgress?.("verifying", 0, controllerNodes.length);
  await Promise.all(
    controllerNodes
      .filter(({ i }) => results[i]?.ok === false)
      .map(({ i }) => reportController(i))
  );

  const verifyCount = Math.max(0, opts.verifyEgressCount ?? 0);
  if (verifyCount && controllerNodes.length) {
    const priority = new Set(opts.verifyProxyIds ?? []);
    const candidates = controllerNodes
      .filter(({ i }) => results[i]?.ok)
      .sort(({ i: a, p: pa }, { i: b, p: pb }) => {
        const priorityDiff = Number(priority.has(pb.id)) - Number(priority.has(pa.id));
        if (priorityDiff) return priorityDiff;
        return (results[a]?.latencyMs ?? Infinity) - (results[b]?.latencyMs ?? Infinity);
      });
    const uniqueIps = new Set<string>();
    for (const { i, p } of candidates) {
      if (!await mayContinue()) break;
      const full = await probePoolProxy(p, bridge, { ...opts, fastController: false, clashQueue });
      if (wasCancelled()) break;
      results[i] = full;
      await reportController(i);
      if (full.ok && full.egressIp) uniqueIps.add(full.egressIp);
      if (uniqueIps.size >= verifyCount) break;
    }
  }
  if (schedulingStopped || wasCancelled()) {
    return results.filter(
      (result, i): result is ProbeResult => finalizedIndexes.has(i) && Boolean(result)
    );
  }

  // Any fast-screened nodes left after reaching the requested egress count
  // keep their delay result and still count as completed.
  await Promise.all(
    controllerNodes
      .filter(({ i }) => Boolean(results[i]))
      .map(({ i }) => reportController(i))
  );

  for (const { i, p } of bridged) {
    if (!await mayContinue()) break;
    const result = await probePoolProxy(p, bridge, { ...opts, clashQueue });
    if (wasCancelled()) break;
    results[i] = result;
    await report(i, result);
  }

  return results.filter(
    (result, i): result is ProbeResult => finalizedIndexes.has(i) && Boolean(result)
  );
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
