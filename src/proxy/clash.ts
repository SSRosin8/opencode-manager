/**
 * Fetch and parse Clash-style proxy subscriptions into pool entries.
 *
 * Supported inputs:
 * - Clash YAML (proxies: [...]) — raw or base64-wrapped
 * - Base64 or plain multi-line proxy URIs
 *   (http/https/socks5, plus vless/vmess/trojan/ss/hysteria2/tuic for Clash bridge)
 *
 * Direct undici egress only for http/socks*. Protocol nodes (vless/…​) are still
 * imported and become usable when Clash Bridge is enabled (local Mihomo/Clash).
 */

import { parse as parseYaml } from "yaml";
import {
  newProxyId,
  isUsableProtocol,
  isClashProtocol,
  normalizeProtocol,
  type PoolProxy,
} from "./pool.js";

export type ClashHints = {
  mixedPort?: number;
  port?: number;
  socksPort?: number;
  externalController?: string;
  /** Select-type group names (first is preferred default). */
  selectorGroups?: string[];
};

export type ClashParseResult = {
  proxies: PoolProxy[];
  /** Direct http/socks usable without bridge. */
  usableCount: number;
  /** Protocol nodes that need Clash bridge (or are disabled). */
  skippedCount: number;
  /** Nodes that can work via Clash bridge (vless/hy2/…). */
  bridgeableCount: number;
  format: "clash-yaml" | "uri-list" | "empty";
  clashHints?: ClashHints;
  /** Which User-Agent produced the body (fetch only). */
  usedUserAgent?: string;
};

const TUNNEL_PROTOS = [
  "ss",
  "ssr",
  "vmess",
  "vless",
  "trojan",
  "hysteria",
  "hysteria2",
  "hy2",
  "tuic",
  "wireguard",
  "anytls",
] as const;

/** User-Agents tried in order — many providers (incl. mitce) switch format by UA. */
export const SUBSCRIPTION_USER_AGENTS = [
  "clash",
  "ClashMeta/1.18.0",
  "clash-verge/1.7.7",
  "ClashforWindows/0.20.39",
  "v2rayN/6.45",
  "OCFreeRelay/1.0",
] as const;

function tryParseClashYamlProxies(text: string): Array<Record<string, unknown>> | null {
  try {
    const doc = parseYaml(text) as Record<string, unknown> | null;
    if (doc && Array.isArray(doc.proxies)) {
      return doc.proxies as Array<Record<string, unknown>>;
    }
  } catch {
    /* fall through */
  }
  return parseProxiesYamlFallback(text);
}

function extractClashHints(text: string): ClashHints | undefined {
  try {
    const doc = parseYaml(text) as Record<string, unknown> | null;
    if (!doc || typeof doc !== "object") return undefined;
    const hints: ClashHints = {};
    if (typeof doc["mixed-port"] === "number") hints.mixedPort = doc["mixed-port"];
    if (typeof doc.port === "number") hints.port = doc.port;
    if (typeof doc["socks-port"] === "number") hints.socksPort = doc["socks-port"];
    if (typeof doc["external-controller"] === "string") {
      const ec = doc["external-controller"].trim();
      hints.externalController = ec.startsWith("http") ? ec : `http://${ec}`;
    }
    const groups = doc["proxy-groups"];
    if (Array.isArray(groups)) {
      const selectors: string[] = [];
      for (const g of groups) {
        if (!g || typeof g !== "object") continue;
        const rec = g as Record<string, unknown>;
        if (rec.type === "select" && typeof rec.name === "string") {
          selectors.push(rec.name);
        }
      }
      if (selectors.length) hints.selectorGroups = selectors;
    }
    return Object.keys(hints).length ? hints : undefined;
  } catch {
    return undefined;
  }
}

function parseProxiesYamlFallback(text: string): Array<Record<string, unknown>> | null {
  const idx = text.search(/^proxies:\s*$/m);
  if (idx < 0) return null;
  const slice = text.slice(idx + "proxies:".length);
  const items: Array<Record<string, unknown>> = [];
  let current: Record<string, unknown> | null = null;

  for (const line of slice.split(/\r?\n/)) {
    if (/^[a-zA-Z0-9_-]+:\s*/.test(line) && !/^\s/.test(line) && line.trim() !== "") {
      break;
    }
    const itemStartNamed = line.match(/^\s*-\s+name:\s*(.+)\s*$/);
    const itemStartInline = line.match(/^\s*-\s*\{(.+)\}\s*$/);

    if (itemStartInline) {
      if (current) items.push(current);
      current = parseInlineMap(itemStartInline[1]);
      continue;
    }
    if (itemStartNamed) {
      if (current) items.push(current);
      current = { name: unquote(itemStartNamed[1]) };
      continue;
    }
    if (line.match(/^\s*-\s*$/)) {
      if (current) items.push(current);
      current = {};
      continue;
    }
    const dashKv = line.match(/^\s*-\s+([A-Za-z0-9_-]+):\s*(.+)\s*$/);
    if (dashKv) {
      if (current && Object.keys(current).length) items.push(current);
      current = { [dashKv[1]]: coerce(unquote(dashKv[2])) };
      continue;
    }

    const kv = line.match(/^\s+([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (kv && current) {
      current[kv[1]] = coerce(unquote(kv[2]));
    }
  }
  if (current && Object.keys(current).length) items.push(current);
  return items.length ? items : null;
}

function parseInlineMap(inner: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const parts = inner.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  for (const part of parts) {
    const m = part.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.+?)\s*$/);
    if (!m) continue;
    out[m[1]] = coerce(unquote(m[2].trim()));
  }
  return out;
}

function unquote(s: string): string {
  const t = s.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

function coerce(s: string): string | number | boolean {
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^\d+$/.test(s)) return Number(s);
  return s;
}

/** Clash hy2 often uses `ports: "20200-20399"` instead of a single `port`. */
function extractPort(item: Record<string, unknown>): number {
  if (typeof item.port === "number" && item.port > 0) return Math.floor(item.port);
  if (typeof item.port === "string" && /^\d+$/.test(item.port.trim())) {
    return Number(item.port.trim());
  }
  const ports = item.ports;
  if (typeof ports === "number" && ports > 0) return Math.floor(ports);
  if (typeof ports === "string") {
    // "20200-20399" or "443,8443"
    const m = ports.trim().match(/(\d+)/);
    if (m) return Number(m[1]);
  }
  return NaN;
}

function clashItemToPoolProxy(
  item: Record<string, unknown>,
  subscriptionId?: string
): PoolProxy | null {
  const server =
    (typeof item.server === "string" && item.server) ||
    (typeof item.host === "string" && item.host) ||
    "";
  const port = extractPort(item);
  if (!server || !Number.isFinite(port) || port <= 0) return null;

  const clashType = String(item.type || "http").toLowerCase();
  // Skip proxy-group-like types accidentally nested
  if (["select", "url-test", "fallback", "load-balance", "relay"].includes(clashType)) {
    return null;
  }

  const type = normalizeProtocol(clashType === "hy2" ? "hysteria2" : clashType);
  const direct = isUsableProtocol(type);
  const bridgeable = isClashProtocol(type);
  const name =
    (typeof item.name === "string" && item.name) ||
    `${clashType}://${server}:${port}`;

  const username =
    (typeof item.username === "string" && item.username) ||
    (typeof item.user === "string" && item.user) ||
    (typeof item.uuid === "string" && item.uuid) ||
    undefined;
  const password =
    (typeof item.password === "string" && item.password) ||
    (typeof item.pass === "string" && item.pass) ||
    undefined;

  return {
    id: newProxyId("clash"),
    name,
    type: direct ? type : clashType === "hy2" ? "hysteria2" : clashType,
    host: server,
    port: Math.floor(port),
    username: username || undefined,
    password: password || undefined,
    // Keep protocol nodes enabled so they appear bindable once bridge is on
    enabled: true,
    source: subscriptionId ? "subscription" : "manual",
    subscriptionId,
    clashType,
    usable: direct,
    bridgeable: bridgeable || direct,
    clashNodeName: name,
  };
}

/**
 * Parse scheme://[userinfo@]host:port[?query][#name]
 * Handles vless/vmess/trojan/ss/hysteria2/tuic share links.
 */
export function parseProxyUri(line: string, subscriptionId?: string): PoolProxy | null {
  const raw = line.trim();
  if (!raw || raw.startsWith("#")) return null;

  let urlStr = raw;
  if (urlStr.startsWith("socks://")) {
    urlStr = "socks5://" + urlStr.slice("socks://".length);
  }
  if (urlStr.startsWith("hy2://")) {
    urlStr = "hysteria2://" + urlStr.slice("hy2://".length);
  }

  const protoMatch = urlStr.match(/^([a-z0-9+.-]+):\/\//i);
  if (!protoMatch) return null;
  const proto = protoMatch[1].toLowerCase();

  // Direct http/socks via URL parser
  if (/^(https?|socks5h?|socks4a?)$/i.test(proto)) {
    try {
      const u = new URL(urlStr);
      const host = u.hostname;
      const port = u.port
        ? Number(u.port)
        : u.protocol.startsWith("https")
          ? 443
          : 80;
      if (!host || !port) return null;
      const type = normalizeProtocol(u.protocol.replace(":", ""));
      return {
        id: newProxyId("uri"),
        name: decodeURIComponent(u.hash.replace(/^#/, "")) || `${type}://${host}:${port}`,
        type,
        host,
        port,
        username: u.username ? decodeURIComponent(u.username) : undefined,
        password: u.password ? decodeURIComponent(u.password) : undefined,
        enabled: true,
        source: subscriptionId ? "subscription" : "manual",
        subscriptionId,
        usable: true,
        bridgeable: true,
        clashNodeName:
          decodeURIComponent(u.hash.replace(/^#/, "")) || `${type}://${host}:${port}`,
      };
    } catch {
      return null;
    }
  }

  // Tunnel share links
  if (!(TUNNEL_PROTOS as readonly string[]).includes(proto) && proto !== "hysteria2") {
    return null;
  }

  try {
    const rest = urlStr.slice(proto.length + 3);
    let nameFromHash: string | undefined;
    let main = rest;
    const hashIdx = rest.lastIndexOf("#");
    if (hashIdx >= 0) {
      nameFromHash = decodeURIComponent(rest.slice(hashIdx + 1).replace(/\+/g, " "));
      main = rest.slice(0, hashIdx);
    }
    // strip query
    const qIdx = main.indexOf("?");
    if (qIdx >= 0) main = main.slice(0, qIdx);

    // userinfo@host:port  (host may be [ipv6])
    let hostPort = main;
    let userinfo: string | undefined;
    const at = main.lastIndexOf("@");
    if (at >= 0) {
      userinfo = main.slice(0, at);
      hostPort = main.slice(at + 1);
    }

    let host = "";
    let port = 0;
    if (hostPort.startsWith("[")) {
      const end = hostPort.indexOf("]");
      host = hostPort.slice(1, end);
      const after = hostPort.slice(end + 1);
      port = Number(after.replace(/^:/, "").split("/")[0]);
    } else {
      const colon = hostPort.lastIndexOf(":");
      if (colon < 0) return null;
      host = hostPort.slice(0, colon);
      port = Number(hostPort.slice(colon + 1).split("/")[0]);
    }
    if (!host || !Number.isFinite(port) || port <= 0) return null;

    const type = proto === "hy2" ? "hysteria2" : proto;
    const name = nameFromHash || `${type}://${host}:${port}`;
    return {
      id: newProxyId("uri"),
      name,
      type,
      host,
      port: Math.floor(port),
      username: userinfo ? decodeURIComponent(userinfo.split(":")[0] || userinfo) : undefined,
      password:
        userinfo && userinfo.includes(":")
          ? decodeURIComponent(userinfo.split(":").slice(1).join(":"))
          : undefined,
      enabled: true,
      source: subscriptionId ? "subscription" : "manual",
      subscriptionId,
      clashType: type,
      usable: false,
      bridgeable: true,
      clashNodeName: name,
    };
  } catch {
    return null;
  }
}

function tryDecodeBase64(text: string): string | null {
  const cleaned = text.replace(/\s+/g, "");
  if (cleaned.length < 16) return null;
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(cleaned)) return null;
  try {
    const norm = cleaned.replace(/-/g, "+").replace(/_/g, "/");
    const pad = norm + "=".repeat((4 - (norm.length % 4)) % 4);
    const decoded = Buffer.from(pad, "base64").toString("utf8");
    if (!decoded || /[\x00-\x08\x0e-\x1f]/.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
}

function scoreParsed(result: ClashParseResult): number {
  // Prefer more proxies; boost YAML with names
  return result.proxies.length * 10 + (result.format === "clash-yaml" ? 5 : 0);
}

function finalizeProxies(
  proxies: PoolProxy[],
  format: ClashParseResult["format"],
  clashHints?: ClashHints
): ClashParseResult {
  const cleaned = proxies.filter((p) => p.port > 0 && p.host && p.host !== "unsupported");
  const usableCount = cleaned.filter((p) => p.usable).length;
  const bridgeableCount = cleaned.filter((p) => p.bridgeable && !p.usable).length;
  return {
    proxies: cleaned,
    usableCount,
    skippedCount: cleaned.length - usableCount,
    bridgeableCount,
    format: cleaned.length ? format : "empty",
    clashHints,
  };
}

/**
 * Parse subscription body into pool proxies.
 */
export function parseSubscriptionBody(
  body: string,
  subscriptionId?: string
): ClashParseResult {
  let text = body.trim().replace(/^\uFEFF/, "");
  if (!text) {
    return {
      proxies: [],
      usableCount: 0,
      skippedCount: 0,
      bridgeableCount: 0,
      format: "empty",
    };
  }

  // Base64-wrapped?
  const looksLikeYaml =
    text.includes("proxies:") ||
    text.includes("mixed-port:") ||
    /^port:\s*\d+/m.test(text);
  const looksLikeUri = /^[a-z][a-z0-9+.-]*:\/\//im.test(text);

  if (!looksLikeYaml && !looksLikeUri) {
    const decoded = tryDecodeBase64(text);
    if (decoded) text = decoded.trim();
  } else if (!looksLikeYaml && looksLikeUri === false) {
    const decoded = tryDecodeBase64(text);
    if (decoded && (decoded.includes("proxies:") || decoded.includes("://"))) {
      text = decoded.trim();
    }
  }

  // Still one-line base64 of URI list?
  if (!text.includes("proxies:") && !text.includes("\n") && !text.includes("://")) {
    const decoded = tryDecodeBase64(text);
    if (decoded) text = decoded.trim();
  }

  // Clash YAML
  if (
    text.includes("proxies:") ||
    text.startsWith("mixed-port:") ||
    /^port:\s*\d+/m.test(text)
  ) {
    const items = tryParseClashYamlProxies(text);
    const hints = extractClashHints(text);
    if (items && items.length) {
      const proxies: PoolProxy[] = [];
      for (const item of items) {
        const p = clashItemToPoolProxy(item, subscriptionId);
        if (p) proxies.push(p);
      }
      if (proxies.length) {
        return finalizeProxies(proxies, "clash-yaml", hints);
      }
    }
  }

  // URI list
  let working = text;
  if (!working.includes("://")) {
    const decoded = tryDecodeBase64(working.replace(/\s+/g, ""));
    if (decoded) working = decoded;
  }

  const lines = working.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const proxies: PoolProxy[] = [];
  for (const line of lines) {
    // some providers join with only newlines; also tolerate multi-URI on one line
    const parts = line.includes("://") && line.split(/\s+/).length > 1 ? line.split(/\s+/) : [line];
    for (const part of parts) {
      const p = parseProxyUri(part, subscriptionId);
      if (p) proxies.push(p);
    }
  }

  return finalizeProxies(proxies, "uri-list");
}

export type FetchSubscriptionOptions = {
  url: string;
  subscriptionId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  userAgent?: string;
  /** Try multiple UAs and keep the richest parse (default true). */
  tryMultipleUserAgents?: boolean;
};

async function fetchBody(
  fetchImpl: typeof fetch,
  url: string,
  userAgent: string,
  timeoutMs: number
): Promise<{ text: string; bytes: number; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": userAgent,
        Accept: "*/*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    });
    if (!res.ok) {
      throw new Error(`Subscription HTTP ${res.status} ${res.statusText}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    let text = buf.toString("utf8");
    if (text.includes("\uFFFD") && !text.includes("proxies:") && !text.includes("://")) {
      // treat as pure base64 binary-ish
      text = buf.toString("utf8");
    }
    return { text, bytes: buf.length, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Download a Clash subscription URL and parse into pool proxies.
 * Tries several User-Agents because providers (e.g. mitce) return YAML only for `clash`.
 */
export async function fetchClashSubscription(
  opts: FetchSubscriptionOptions
): Promise<ClashParseResult & { rawBytes: number }> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const multi = opts.tryMultipleUserAgents !== false && !opts.userAgent;

  const agents = opts.userAgent
    ? [opts.userAgent]
    : multi
      ? [...SUBSCRIPTION_USER_AGENTS]
      : [SUBSCRIPTION_USER_AGENTS[0]];

  let best: (ClashParseResult & { rawBytes: number }) | null = null;
  let lastError: Error | null = null;

  for (const ua of agents) {
    try {
      const { text, bytes } = await fetchBody(fetchImpl, opts.url, ua, timeoutMs);
      const parsed = parseSubscriptionBody(text, opts.subscriptionId);
      const candidate = {
        ...parsed,
        rawBytes: bytes,
        usedUserAgent: ua,
      };
      if (!best || scoreParsed(candidate) > scoreParsed(best)) {
        best = candidate;
      }
      // Early exit if we got a solid YAML list
      if (candidate.format === "clash-yaml" && candidate.proxies.length >= 3) {
        break;
      }
      // Or a rich URI list
      if (candidate.proxies.length >= 10) {
        break;
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  if (!best || best.proxies.length === 0) {
    if (lastError) throw lastError;
    if (best) return best;
    throw new Error("Subscription returned no parseable proxies (empty body)");
  }

  return best;
}
