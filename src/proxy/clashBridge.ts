/**
 * Switch Clash/Mihomo select-group to a node, then traffic exits via local mixed-port.
 * Used so vless/hysteria2/tuic subscription nodes can back OpenCode free workers.
 */

import { createHash } from "node:crypto";
import type { ClashBridgeConfig, PoolProxy } from "./pool.js";

type ClashProxyInfo = {
  name?: string;
  type?: string;
  all?: string[];
  now?: string;
};

export const DEFAULT_CONTROLLER_TIMEOUT_MS = 5000;

async function fetchController(
  fetchImpl: typeof fetch,
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs = DEFAULT_CONTROLLER_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const externalSignal = init.signal;
  const forwardAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) forwardAbort();
  else externalSignal?.addEventListener("abort", forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", forwardAbort);
  }
}

function controllerHeaders(bridge: ClashBridgeConfig): Record<string, string> {
  const headers: Record<string, string> = {};
  if (bridge.apiSecret) headers.Authorization = `Bearer ${bridge.apiSecret}`;
  return headers;
}

function controllerNodeId(apiBase: string, name: string): string {
  const digest = createHash("sha256")
    .update(`${apiBase.replace(/\/+$/, "")}\n${name}`)
    .digest("hex")
    .slice(0, 24);
  return `controller_${digest}`;
}

/** Import leaf nodes already loaded by a running Clash/Mihomo Controller. */
export async function importClashControllerNodes(
  bridge: ClashBridgeConfig,
  fetchImpl: typeof fetch = globalThis.fetch,
  timeoutMs = DEFAULT_CONTROLLER_TIMEOUT_MS
): Promise<{
  proxies: PoolProxy[];
  group: string;
  current: string | null;
  groups: string[];
}> {
  const base = bridge.apiBase.replace(/\/+$/, "");
  const res = await fetchController(fetchImpl, `${base}/proxies`, {
    headers: controllerHeaders(bridge),
  }, timeoutMs);
  if (!res.ok) {
    await res.text().catch(() => "");
    throw new Error(`controller HTTP ${res.status} on /proxies`);
  }

  const body = (await res.json()) as { proxies?: Record<string, ClashProxyInfo> };
  const all = body.proxies || {};
  const groups = Object.entries(all)
    .filter(([, info]) => info?.type === "Selector")
    .map(([name]) => name);
  const selector = all[bridge.selectorGroup];
  if (!selector || selector.type !== "Selector" || !Array.isArray(selector.all)) {
    throw new Error(
      `selector group "${bridge.selectorGroup}" not found` +
        (groups.length ? ` (available: ${groups.join(", ")})` : "")
    );
  }

  const groupTypes = new Set([
    "selector",
    "urltest",
    "fallback",
    "loadbalance",
    "relay",
    "direct",
    "reject",
    "rejectdrop",
    "pass",
    "compatible",
  ]);
  const reserved = new Set(["DIRECT", "REJECT", "REJECT-DROP", "PASS", "COMPATIBLE"]);
  const seen = new Set<string>();
  const proxies: PoolProxy[] = [];
  for (const name of selector.all) {
    if (!name || seen.has(name) || reserved.has(name.toUpperCase())) continue;
    seen.add(name);
    const info = all[name];
    if (!info) continue;
    const clashType = String(info.type || "controller");
    if (groupTypes.has(clashType.toLowerCase().replace(/[-_\s]/g, ""))) continue;
    proxies.push({
      id: controllerNodeId(base, name),
      name,
      type: clashType.toLowerCase(),
      host: bridge.localProxyHost,
      port: bridge.localProxyPort,
      enabled: true,
      source: "controller",
      controllerGroup: bridge.selectorGroup,
      clashType,
      usable: false,
      bridgeable: true,
      clashNodeName: name,
    });
  }
  if (!proxies.length) {
    throw new Error(`selector group "${bridge.selectorGroup}" contains no importable leaf nodes`);
  }
  return {
    proxies,
    group: bridge.selectorGroup,
    current: typeof selector.now === "string" ? selector.now : null,
    groups,
  };
}

/** Check one loaded node without changing the shared selector group. */
export async function probeClashNodeDelay(
  bridge: ClashBridgeConfig,
  nodeName: string,
  timeoutMs = 3500,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<number> {
  const base = bridge.apiBase.replace(/\/+$/, "");
  const url = new URL(`${base}/proxies/${encodeURIComponent(nodeName)}/delay`);
  url.searchParams.set("timeout", String(timeoutMs));
  url.searchParams.set("url", "https://www.gstatic.com/generate_204");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs + 1500);
  try {
    const res = await fetchImpl(url, {
      headers: controllerHeaders(bridge),
      signal: controller.signal,
    });
    if (!res.ok) {
      await res.text().catch(() => "");
      throw new Error(`controller delay HTTP ${res.status}`);
    }
    const body = (await res.json()) as { delay?: unknown };
    const delay = Number(body.delay);
    if (!Number.isFinite(delay) || delay < 0) throw new Error("invalid controller delay");
    return Math.round(delay);
  } finally {
    clearTimeout(timer);
  }
}

export async function getClashSelectorCurrent(
  bridge: ClashBridgeConfig,
  fetchImpl: typeof fetch = globalThis.fetch,
  timeoutMs = DEFAULT_CONTROLLER_TIMEOUT_MS
): Promise<string | null> {
  const base = bridge.apiBase.replace(/\/+$/, "");
  const res = await fetchController(
    fetchImpl,
    `${base}/proxies/${encodeURIComponent(bridge.selectorGroup)}`,
    { headers: controllerHeaders(bridge) },
    timeoutMs
  );
  if (!res.ok) {
    await res.text().catch(() => "");
    return null;
  }
  const body = (await res.json().catch(() => ({}))) as { now?: unknown };
  return typeof body.now === "string" && body.now ? body.now : null;
}

/**
 * PUT /proxies/{group}  body: { name: nodeName }
 * Switches only the configured group. Trying another selector can report success
 * while rule-mode traffic still exits through the configured routing group.
 */
export async function selectClashProxy(
  bridge: ClashBridgeConfig,
  nodeName: string,
  fetchImpl: typeof fetch = globalThis.fetch,
  timeoutMs = DEFAULT_CONTROLLER_TIMEOUT_MS
): Promise<{ group: string }> {
  const base = bridge.apiBase.replace(/\/+$/, "");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (bridge.apiSecret) {
    headers.Authorization = `Bearer ${bridge.apiSecret}`;
  }

  const trySwitch = async (group: string): Promise<boolean> => {
    const url = `${base}/proxies/${encodeURIComponent(group)}`;
    const res = await fetchController(fetchImpl, url, {
      method: "PUT",
      headers,
      body: JSON.stringify({ name: nodeName }),
    }, timeoutMs);
    if (res.ok) return true;
    // drain body
    await res.text().catch(() => "");
    return false;
  };

  // Fail closed: only the configured routing group is authoritative.
  if (await trySwitch(bridge.selectorGroup)) {
    return { group: bridge.selectorGroup };
  }

  throw new Error(
    `Clash switch failed: node "${nodeName}" not selectable in group "${bridge.selectorGroup}"`
  );
}

/** Probe controller: GET /version or /proxies */
export async function probeClashBridge(
  bridge: ClashBridgeConfig,
  fetchImpl: typeof fetch = globalThis.fetch,
  timeoutMs = DEFAULT_CONTROLLER_TIMEOUT_MS
): Promise<{ ok: boolean; message: string; groups?: string[] }> {
  const base = bridge.apiBase.replace(/\/+$/, "");
  const headers = controllerHeaders(bridge);

  try {
    const verRes = await fetchController(fetchImpl, `${base}/version`, { headers }, timeoutMs);
    if (!verRes.ok) {
      return { ok: false, message: `controller HTTP ${verRes.status} on /version` };
    }
    const ver = (await verRes.json().catch(() => ({}))) as { version?: string };
    let groups: string[] | undefined;
    try {
      const pRes = await fetchController(fetchImpl, `${base}/proxies`, { headers }, timeoutMs);
      if (pRes.ok) {
        const body = (await pRes.json()) as {
          proxies?: Record<string, { type?: string }>;
        };
        groups = Object.entries(body.proxies || {})
          .filter(([, v]) => v?.type === "Selector")
          .map(([k]) => k);
      }
    } catch {
      /* optional */
    }
    return {
      ok: true,
      message: `Clash connected${ver.version ? ` v${ver.version}` : ""}`,
      groups,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Serialize Clash selector switches so concurrent workers don't race the same mixed-port.
 */
export class ClashSwitchQueue {
  private chain: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }
}
