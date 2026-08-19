/**
 * Proxy pool: shared list of egress proxies that workers (accounts) can bind to.
 * OpenCode free accounts are IP-bound — each worker should use a distinct exit IP.
 */

import { randomUUID } from "node:crypto";
import type { AccountProxy } from "../relay/accounts.js";

export type ProxyProtocol = "http" | "https" | "socks5" | "socks4";

/** One entry in the gateway proxy pool. */
export type PoolProxy = {
  id: string;
  /** Display name (Clash node name or manual label). */
  name: string;
  type: ProxyProtocol | string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  /** Soft-disable without deleting. */
  enabled: boolean;
  /** Origin of this entry. */
  source: "manual" | "subscription" | "controller";
  /** When source=subscription, which subscription produced it. */
  subscriptionId?: string;
  /** Selector group used when imported from a running Clash Controller. */
  controllerGroup?: string;
  /** Original Clash type if different (ss, vmess, …) — informational. */
  clashType?: string;
  /**
   * Direct undici/socks egress without local Clash.
   * False for vless/hysteria2/… unless Clash Bridge rewrites usable at resolve-time.
   */
  usable: boolean;
  /**
   * Can be used via local Clash/Mihomo bridge (selector switch + local mixed-port).
   */
  bridgeable?: boolean;
  /** Clash selector node name (usually same as name). */
  clashNodeName?: string;
};

export type ProxySubscription = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  lastFetchedAt: string | null;
  lastError: string | null;
  /** Count of proxies last imported (direct + bridgeable). */
  lastImportCount: number;
  /** Direct http/socks count last import. */
  lastDirectCount?: number;
  /** Bridgeable protocol count last import. */
  lastBridgeableCount?: number;
  lastFormat?: string;
  lastUserAgent?: string;
};

/** Local Clash / Mihomo bridge for vless/hy2/tuic nodes. */
export type ClashBridgeConfig = {
  enabled: boolean;
  /** External controller base, e.g. http://127.0.0.1:9090 */
  apiBase: string;
  /** Bearer/API secret if set in Clash. */
  apiSecret: string;
  /** Local HTTP mixed-port used as undici ProxyAgent target. */
  localProxyHost: string;
  localProxyPort: number;
  /**
   * Select-type group to switch before each request.
   * mitce default group is often `主代理` or `GLOBAL`.
   */
  selectorGroup: string;
};

export const DEFAULT_CLASH_BRIDGE: ClashBridgeConfig = {
  enabled: false,
  apiBase: "http://127.0.0.1:9090",
  apiSecret: "",
  localProxyHost: "127.0.0.1",
  localProxyPort: 7890,
  selectorGroup: "GLOBAL",
};

export function newProxyId(prefix = "px"): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function normalizeProtocol(type: string): string {
  const t = type.toLowerCase().trim();
  if (t === "socks" || t === "socks5" || t === "socks5h") return "socks5";
  if (t === "socks4" || t === "socks4a") return "socks4";
  if (t === "https") return "https";
  if (t === "http" || t === "http-connect") return "http";
  if (t === "hy2") return "hysteria2";
  return t;
}

/** Whether protocol is directly usable for gateway egress (no Clash). */
export function isUsableProtocol(type: string): boolean {
  const t = normalizeProtocol(type);
  return t === "http" || t === "https" || t === "socks5" || t === "socks4";
}

/** Protocol nodes that require Clash/Mihomo local bridge. */
export function isClashProtocol(type: string): boolean {
  const t = normalizeProtocol(type);
  return [
    "ss",
    "ssr",
    "vmess",
    "vless",
    "trojan",
    "hysteria",
    "hysteria2",
    "tuic",
    "wireguard",
    "anytls",
  ].includes(t);
}

export function normalizePoolProxy(raw: unknown, index = 0): PoolProxy | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const host = typeof p.host === "string" ? p.host.trim() : "";
  const port = typeof p.port === "number" ? p.port : Number(p.port);
  if (!host || !Number.isFinite(port) || port <= 0 || port > 65535) return null;

  const typeRaw = typeof p.type === "string" ? p.type.toLowerCase().trim() : "http";
  const type = normalizeProtocol(typeRaw);
  const direct = isUsableProtocol(type);
  const bridgeable =
    typeof p.bridgeable === "boolean" ? p.bridgeable : direct || isClashProtocol(type);
  const usable =
    typeof p.usable === "boolean" ? p.usable : direct;

  return {
    id: typeof p.id === "string" && p.id ? p.id : newProxyId(`px${index}`),
    name:
      typeof p.name === "string" && p.name.trim()
        ? p.name.trim()
        : `${type}://${host}:${port}`,
    type,
    host,
    port: Math.floor(port),
    username: typeof p.username === "string" && p.username ? p.username : undefined,
    password: typeof p.password === "string" && p.password ? p.password : undefined,
    enabled: p.enabled === false ? false : true,
    source:
      p.source === "subscription"
        ? "subscription"
        : p.source === "controller"
          ? "controller"
          : "manual",
    subscriptionId:
      typeof p.subscriptionId === "string" && p.subscriptionId
        ? p.subscriptionId
        : undefined,
    controllerGroup:
      typeof p.controllerGroup === "string" && p.controllerGroup
        ? p.controllerGroup
        : undefined,
    clashType: typeof p.clashType === "string" ? p.clashType : undefined,
    usable,
    bridgeable,
    clashNodeName:
      typeof p.clashNodeName === "string" && p.clashNodeName
        ? p.clashNodeName
        : typeof p.name === "string"
          ? p.name
          : undefined,
  };
}

export function normalizeProxyPool(raw: unknown): PoolProxy[] {
  if (!Array.isArray(raw)) return [];
  const out: PoolProxy[] = [];
  for (let i = 0; i < raw.length; i++) {
    const p = normalizePoolProxy(raw[i], i);
    if (p) out.push(p);
  }
  return out;
}

export function normalizeSubscriptions(raw: unknown): ProxySubscription[] {
  if (!Array.isArray(raw)) return [];
  const out: ProxySubscription[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const url = typeof s.url === "string" ? s.url.trim() : "";
    if (!url) continue;
    const sub: ProxySubscription = {
      id: typeof s.id === "string" && s.id ? s.id : newProxyId(`sub${i}`),
      name:
        typeof s.name === "string" && s.name.trim()
          ? s.name.trim()
          : `subscription-${i + 1}`,
      url,
      enabled: s.enabled === false ? false : true,
      lastFetchedAt: typeof s.lastFetchedAt === "string" ? s.lastFetchedAt : null,
      lastError: typeof s.lastError === "string" ? s.lastError : null,
      lastImportCount:
        typeof s.lastImportCount === "number" && s.lastImportCount >= 0
          ? s.lastImportCount
          : 0,
    };
    if (typeof s.lastDirectCount === "number") sub.lastDirectCount = s.lastDirectCount;
    if (typeof s.lastBridgeableCount === "number") {
      sub.lastBridgeableCount = s.lastBridgeableCount;
    }
    if (typeof s.lastFormat === "string") sub.lastFormat = s.lastFormat;
    if (typeof s.lastUserAgent === "string") sub.lastUserAgent = s.lastUserAgent;
    out.push(sub);
  }
  return out;
}

export function normalizeClashBridge(raw: unknown): ClashBridgeConfig {
  const d = DEFAULT_CLASH_BRIDGE;
  if (!raw || typeof raw !== "object") return { ...d };
  const b = raw as Record<string, unknown>;
  return {
    enabled: Boolean(b.enabled),
    apiBase:
      typeof b.apiBase === "string" && b.apiBase.trim()
        ? b.apiBase.trim().replace(/\/+$/, "")
        : d.apiBase,
    apiSecret: typeof b.apiSecret === "string" ? b.apiSecret : "",
    localProxyHost:
      typeof b.localProxyHost === "string" && b.localProxyHost.trim()
        ? b.localProxyHost.trim()
        : d.localProxyHost,
    localProxyPort:
      typeof b.localProxyPort === "number" && b.localProxyPort > 0
        ? Math.floor(b.localProxyPort)
        : d.localProxyPort,
    selectorGroup:
      typeof b.selectorGroup === "string" && b.selectorGroup.trim()
        ? b.selectorGroup.trim()
        : d.selectorGroup,
  };
}

export function poolProxyToAccountProxy(p: PoolProxy | null | undefined): AccountProxy {
  if (!p || !p.enabled || !p.usable) return null;
  return {
    type: p.type,
    host: p.host,
    port: p.port,
    username: p.username,
    password: p.password,
  };
}

export type ResolvedEgress = {
  /** undici ProxyAgent target (null = direct). */
  proxy: AccountProxy;
  /** When set, switch Clash selector to this node before the request. */
  clashNodeName: string | null;
  poolId: string | null;
};

/**
 * Resolve effective egress for a worker:
 * 1) proxyId → pool entry
 *    - direct http/socks if usable
 *    - else Clash bridge local proxy + node name if bridge enabled & bridgeable
 * 2) legacy inline account.proxy
 * 3) direct
 */
export function resolveAccountEgress(
  account: { proxyId?: string | null; proxy?: AccountProxy },
  pool: PoolProxy[],
  bridge?: ClashBridgeConfig | null
): ResolvedEgress {
  if (account.proxyId) {
    const found = pool.find((p) => p.id === account.proxyId);
    if (found && found.enabled) {
      if (found.usable) {
        return {
          proxy: poolProxyToAccountProxy(found),
          clashNodeName: null,
          poolId: found.id,
        };
      }
      if (bridge?.enabled && (found.bridgeable || isClashProtocol(found.type))) {
        return {
          proxy: {
            type: "http",
            host: bridge.localProxyHost,
            port: bridge.localProxyPort,
          },
          clashNodeName: found.clashNodeName || found.name,
          poolId: found.id,
        };
      }
      // Bound but unusable without bridge — fall through to direct with warning via null node
      return { proxy: null, clashNodeName: null, poolId: found.id };
    }
  }
  return {
    proxy: account.proxy ?? null,
    clashNodeName: null,
    poolId: null,
  };
}

/** @deprecated use resolveAccountEgress */
export function resolveAccountProxy(
  account: { proxyId?: string | null; proxy?: AccountProxy },
  pool: PoolProxy[],
  bridge?: ClashBridgeConfig | null
): AccountProxy {
  return resolveAccountEgress(account, pool, bridge).proxy;
}

/**
 * Merge subscription-imported proxies into the pool:
 * - remove previous entries from the same subscriptionId
 * - keep all manual entries and other subscriptions
 * - append fresh imported list
 */
export function mergeSubscriptionProxies(
  pool: PoolProxy[],
  subscriptionId: string,
  imported: PoolProxy[]
): PoolProxy[] {
  const kept = pool.filter(
    (p) => !(p.source === "subscription" && p.subscriptionId === subscriptionId)
  );
  const tagged = imported.map((p) => ({
    ...p,
    source: "subscription" as const,
    subscriptionId,
  }));
  return [...kept, ...tagged];
}

/** Replace nodes imported from one Controller selector while preserving stable bindings. */
export function mergeControllerProxies(
  pool: PoolProxy[],
  controllerGroup: string,
  imported: PoolProxy[]
): PoolProxy[] {
  const kept = pool.filter(
    (p) => !(p.source === "controller" && p.controllerGroup === controllerGroup)
  );
  return [...kept, ...imported];
}

/** Build undici/socks proxy URI. */
export function proxyToUri(proxy: NonNullable<AccountProxy>): string {
  const auth =
    proxy.username || proxy.password
      ? `${encodeURIComponent(proxy.username || "")}:${encodeURIComponent(proxy.password || "")}@`
      : "";
  const t = normalizeProtocol(proxy.type || "http");
  const scheme =
    t === "socks5" || t === "socks4" ? t : t === "https" ? "https" : "http";
  return `${scheme}://${auth}${proxy.host}:${proxy.port}`;
}

/** Whether a pool entry can be selected for a worker given current bridge settings. */
export function isBindablePoolProxy(
  p: PoolProxy,
  bridge?: ClashBridgeConfig | null
): boolean {
  if (!p.enabled) return false;
  if (p.usable) return true;
  if (bridge?.enabled && (p.bridgeable || isClashProtocol(p.type))) return true;
  return false;
}

/** Minimal probe snapshot used when auto-assigning healthy proxies. */
export type ProbeHealthSnapshot = {
  ok?: boolean;
  health?: string;
  latencyMs?: number | null;
  egressIp?: string | null;
  anonymousZen?: { ok?: boolean } | null;
};

export type AssignHealthyProxiesInput = {
  accounts: Array<{
    id: string;
    apiKey: string;
    kind?: "anonymous_zen" | "authenticated_zen";
    proxyId?: string | null;
    proxy?: AccountProxy;
  }>;
  pool: PoolProxy[];
  /** Last probe results keyed by pool proxy id. Only `ok && health==="healthy"` are used. */
  probeResults: Record<string, ProbeHealthSnapshot | undefined>;
  bridge?: ClashBridgeConfig | null;
};

export type AssignHealthyProxiesResult = {
  accounts: Array<{
    id: string;
    apiKey: string;
    kind?: "anonymous_zen" | "authenticated_zen";
    proxyId: string | null;
    proxy: AccountProxy;
  }>;
  /** Workers that received a healthy proxy. */
  assigned: number;
  /** Workers left without a binding (not enough healthy proxies). */
  unassigned: number;
  /** Distinct healthy+bindable proxies available at assign time. */
  healthyAvailable: number;
  assignments: Array<{
    accountId: string;
    proxyId: string | null;
    proxyName: string | null;
  }>;
};

/**
 * Bind each worker to a unique pool proxy that probed healthy.
 * Prefer lower latency; reassign all workers (does not share one proxy across workers).
 * When healthy proxies run out, remaining workers get proxyId=null.
 */
export function assignHealthyProxiesToWorkers(
  input: AssignHealthyProxiesInput
): AssignHealthyProxiesResult {
  const healthy = input.pool
    .filter((p) => {
      if (!isBindablePoolProxy(p, input.bridge)) return false;
      const pr = input.probeResults[p.id];
      if (!(pr && pr.ok && pr.health === "healthy")) return false;
      if (!pr.anonymousZen?.ok) return false;
      return p.source !== "controller" || Boolean(pr.egressIp);
    })
    .sort((a, b) => {
      const la = input.probeResults[a.id]?.latencyMs;
      const lb = input.probeResults[b.id]?.latencyMs;
      const na = typeof la === "number" && Number.isFinite(la) ? la : Number.POSITIVE_INFINITY;
      const nb = typeof lb === "number" && Number.isFinite(lb) ? lb : Number.POSITIVE_INFINITY;
      if (na !== nb) return na - nb;
      return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    })
    .filter((p, index, list) => {
      const ip = input.probeResults[p.id]?.egressIp;
      if (!ip) return true;
      return list.findIndex((candidate) => input.probeResults[candidate.id]?.egressIp === ip) === index;
    });

  const cursorByKind = { anonymous_zen: 0, authenticated_zen: 0 };
  let assigned = 0;
  let unassigned = 0;
  const assignments: AssignHealthyProxiesResult["assignments"] = [];
  const accounts = input.accounts.map((a) => {
    const kind: "anonymous_zen" | "authenticated_zen" =
      a.kind === "authenticated_zen"
        ? "authenticated_zen"
        : a.kind === "anonymous_zen"
          ? "anonymous_zen"
          : a.apiKey.trim()
            ? "authenticated_zen"
            : "anonymous_zen";
    const cursor = cursorByKind[kind];
    if (cursor < healthy.length) {
      const p = healthy[cursor];
      cursorByKind[kind] += 1;
      assigned += 1;
      assignments.push({ accountId: a.id, proxyId: p.id, proxyName: p.name });
      return {
        id: a.id,
        apiKey: a.apiKey ?? "",
        kind,
        proxyId: p.id,
        proxy: null as AccountProxy,
      };
    }
    unassigned += 1;
    assignments.push({ accountId: a.id, proxyId: null, proxyName: null });
    return {
      id: a.id,
      apiKey: a.apiKey ?? "",
      kind,
      proxyId: null,
      proxy: null as AccountProxy,
    };
  });

  return {
    accounts,
    assigned,
    unassigned,
    healthyAvailable: healthy.length,
    assignments,
  };
}
