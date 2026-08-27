import { parse as parseYaml } from "yaml";
import {
  isClashProtocol,
  isUsableProtocol,
  newProxyId,
  normalizeProtocol,
  type PoolProxy,
} from "./pool.js";

export type ClashHints = {
  mixedPort?: number;
  port?: number;
  socksPort?: number;
  externalController?: string;
  selectorGroups?: string[];
};

export type ClashParseResult = {
  proxies: PoolProxy[];
  usableCount: number;
  skippedCount: number;
  bridgeableCount: number;
  format: "clash-yaml" | "uri-list" | "empty";
  clashHints?: ClashHints;
  usedUserAgent?: string;
};

const TUNNEL_PROTOCOLS = new Set([
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
]);

function decodeBase64(value: string): string | null {
  const cleaned = value
    .trim()
    .replace(/\s+/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  if (!cleaned || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) return null;
  try {
    const padded = cleaned + "=".repeat((4 - (cleaned.length % 4)) % 4);
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    return decoded && !/[\x00-\x08\x0e-\x1f]/.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function decodeName(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

function decodeBodyLayers(body: string): string {
  let text = body.trim().replace(/^\uFEFF/, "");
  for (let depth = 0; depth < 3; depth++) {
    if (looksStructured(text) || /[a-z][a-z0-9+.-]*:\/\//i.test(text)) break;
    const decoded = decodeBase64(text);
    if (!decoded || decoded === text) break;
    text = decoded.trim().replace(/^\uFEFF/, "");
  }
  return text;
}

function looksStructured(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    /^(?:proxies|mixed-port|port):/m.test(trimmed)
  );
}

function extractPort(item: Record<string, unknown>): number {
  const port = Number(item.port ?? item.server_port);
  if (Number.isFinite(port) && port > 0) return Math.floor(port);
  const ports = item.ports;
  if (typeof ports === "string") {
    const match = ports.match(/\d+/);
    if (match) return Number(match[0]);
  }
  return NaN;
}

function poolProxy(
  typeValue: string,
  host: string,
  port: number,
  name: string,
  subscriptionId?: string,
  username?: string,
  password?: string,
): PoolProxy {
  const type = normalizeProtocol(typeValue === "hy2" ? "hysteria2" : typeValue);
  const usable = isUsableProtocol(type);
  return {
    id: newProxyId("sub"),
    name,
    type,
    host,
    port: Math.floor(port),
    username,
    password,
    enabled: true,
    source: subscriptionId ? "subscription" : "manual",
    subscriptionId,
    clashType: type,
    usable,
    bridgeable: usable || isClashProtocol(type),
    clashNodeName: name,
  };
}

function clashItemToProxy(
  item: Record<string, unknown>,
  subscriptionId?: string,
): PoolProxy | null {
  const host =
    typeof item.server === "string"
      ? item.server
      : typeof item.host === "string"
        ? item.host
        : "";
  const port = extractPort(item);
  if (!host || !Number.isFinite(port) || port <= 0 || port > 65535) return null;
  const rawType =
    typeof item.type === "string" ? item.type.toLowerCase() : "http";
  if (
    ["select", "url-test", "fallback", "load-balance", "relay"].includes(
      rawType,
    )
  )
    return null;
  const name =
    typeof item.name === "string" && item.name
      ? item.name
      : `${rawType}://${host}:${port}`;
  const username = [item.username, item.user, item.uuid].find(
    (v) => typeof v === "string",
  ) as string | undefined;
  const password = [item.password, item.pass].find(
    (v) => typeof v === "string",
  ) as string | undefined;
  return poolProxy(
    rawType,
    host,
    port,
    name,
    subscriptionId,
    username,
    password,
  );
}

function sip008ItemToProxy(
  item: Record<string, unknown>,
  subscriptionId?: string,
): PoolProxy | null {
  const host = typeof item.server === "string" ? item.server : "";
  const port = Number(item.server_port);
  if (!host || !Number.isFinite(port) || port <= 0 || port > 65535) return null;
  const name =
    typeof item.remarks === "string" && item.remarks
      ? item.remarks
      : `ss://${host}:${port}`;
  return poolProxy(
    "ss",
    host,
    port,
    name,
    subscriptionId,
    typeof item.method === "string" ? item.method : undefined,
    typeof item.password === "string" ? item.password : undefined,
  );
}

function parseStructured(
  text: string,
  subscriptionId?: string,
): { proxies: PoolProxy[]; hints?: ClashHints } | null {
  let value: unknown;
  try {
    value = parseYaml(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const doc = value as Record<string, unknown>;
  let proxies: PoolProxy[] = [];
  if (Array.isArray(doc.proxies)) {
    proxies = doc.proxies.flatMap((item) => {
      const parsed =
        item && typeof item === "object"
          ? clashItemToProxy(item as Record<string, unknown>, subscriptionId)
          : null;
      return parsed ? [parsed] : [];
    });
  } else if (Array.isArray(doc.servers)) {
    proxies = doc.servers.flatMap((item) => {
      const parsed =
        item && typeof item === "object"
          ? sip008ItemToProxy(item as Record<string, unknown>, subscriptionId)
          : null;
      return parsed ? [parsed] : [];
    });
  }
  if (!proxies.length) return null;
  return { proxies, hints: extractHints(doc) };
}

function extractHints(doc: Record<string, unknown>): ClashHints | undefined {
  const hints: ClashHints = {};
  if (typeof doc["mixed-port"] === "number")
    hints.mixedPort = doc["mixed-port"];
  if (typeof doc.port === "number") hints.port = doc.port;
  if (typeof doc["socks-port"] === "number")
    hints.socksPort = doc["socks-port"];
  if (typeof doc["external-controller"] === "string") {
    const value = doc["external-controller"].trim();
    hints.externalController = value.startsWith("http")
      ? value
      : `http://${value}`;
  }
  if (Array.isArray(doc["proxy-groups"])) {
    const groups = doc["proxy-groups"].flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const group = item as Record<string, unknown>;
      return group.type === "select" && typeof group.name === "string"
        ? [group.name]
        : [];
    });
    if (groups.length) hints.selectorGroups = groups;
  }
  return Object.keys(hints).length ? hints : undefined;
}

function parseEndpoint(value: string): { host: string; port: number } | null {
  if (value.startsWith("[")) {
    const match = value.match(/^\[([^\]]+)]:(\d+)$/);
    return match ? { host: match[1], port: Number(match[2]) } : null;
  }
  const colon = value.lastIndexOf(":");
  if (colon < 1) return null;
  const host = value.slice(0, colon);
  const port = Number(value.slice(colon + 1));
  return host && Number.isFinite(port) && port > 0 && port <= 65535
    ? { host, port }
    : null;
}

function parseVmess(
  payload: string,
  subscriptionId?: string,
): PoolProxy | null {
  const decoded = decodeBase64(payload);
  if (!decoded) return null;
  try {
    const doc = JSON.parse(decoded) as Record<string, unknown>;
    const host = typeof doc.add === "string" ? doc.add : "";
    const port = Number(doc.port);
    if (!host || !Number.isFinite(port) || port <= 0 || port > 65535)
      return null;
    const name =
      typeof doc.ps === "string" && doc.ps ? doc.ps : `vmess://${host}:${port}`;
    return poolProxy(
      "vmess",
      host,
      port,
      name,
      subscriptionId,
      typeof doc.id === "string" ? doc.id : undefined,
    );
  } catch {
    return null;
  }
}

function parseShadowsocks(
  payloadValue: string,
  subscriptionId?: string,
): PoolProxy | null {
  const hash = payloadValue.indexOf("#");
  const nameValue = hash >= 0 ? decodeName(payloadValue.slice(hash + 1)) : "";
  let payload = hash >= 0 ? payloadValue.slice(0, hash) : payloadValue;
  payload = payload.split("?", 1)[0];
  if (!payload.includes("@")) payload = decodeBase64(payload) || payload;
  const at = payload.lastIndexOf("@");
  if (at < 1) return null;
  let credentials = payload.slice(0, at);
  const decodedCredentials = decodeBase64(credentials);
  if (decodedCredentials?.includes(":")) credentials = decodedCredentials;
  const endpoint = parseEndpoint(payload.slice(at + 1));
  if (!endpoint) return null;
  const split = credentials.indexOf(":");
  const method =
    split >= 0 ? decodeName(credentials.slice(0, split)) : undefined;
  const password = decodeName(
    split >= 0 ? credentials.slice(split + 1) : credentials,
  );
  return poolProxy(
    "ss",
    endpoint.host,
    endpoint.port,
    nameValue || `ss://${endpoint.host}:${endpoint.port}`,
    subscriptionId,
    method,
    password,
  );
}

function parseSsr(payload: string, subscriptionId?: string): PoolProxy | null {
  const decoded = decodeBase64(payload);
  if (!decoded) return null;
  const [main, query = ""] = decoded.split("/?", 2);
  const parts = main.split(":");
  if (parts.length < 6) return null;
  const port = Number(parts[1]);
  if (!parts[0] || !Number.isFinite(port) || port <= 0 || port > 65535)
    return null;
  const params = new URLSearchParams(query);
  const remarks = params.get("remarks");
  const name = remarks
    ? decodeBase64(remarks) || decodeName(remarks)
    : `ssr://${parts[0]}:${port}`;
  return poolProxy(
    "ssr",
    parts[0],
    port,
    name,
    subscriptionId,
    parts[3],
    decodeBase64(parts.slice(5).join(":")) || undefined,
  );
}

export function parseProxyUri(
  line: string,
  subscriptionId?: string,
): PoolProxy | null {
  const raw = line.trim();
  if (!raw || raw.startsWith("#")) return null;
  const match = raw.match(/^([a-z0-9+.-]+):\/\/(.*)$/i);
  if (!match) return null;
  let protocol = match[1].toLowerCase();
  const payload = match[2];
  if (protocol === "socks") protocol = "socks5";
  if (protocol === "hy2") protocol = "hysteria2";
  if (protocol === "vmess") return parseVmess(payload, subscriptionId);
  if (protocol === "ss") return parseShadowsocks(payload, subscriptionId);
  if (protocol === "ssr") return parseSsr(payload, subscriptionId);
  if (/^(https?|socks5h?|socks4a?)$/.test(protocol))
    return parseStandardUri(raw, protocol, subscriptionId);
  if (!TUNNEL_PROTOCOLS.has(protocol)) return null;
  return parseTunnelUri(payload, protocol, subscriptionId);
}

function parseStandardUri(
  raw: string,
  protocol: string,
  subscriptionId?: string,
): PoolProxy | null {
  try {
    const normalized =
      protocol === "socks5h"
        ? `socks5://${raw.slice(raw.indexOf("://") + 3)}`
        : raw;
    const url = new URL(normalized);
    const type = normalizeProtocol(protocol);
    const port = url.port
      ? Number(url.port)
      : protocol.startsWith("https")
        ? 443
        : 80;
    if (!url.hostname || !Number.isFinite(port) || port <= 0) return null;
    const name =
      decodeName(url.hash.slice(1)) || `${type}://${url.hostname}:${port}`;
    return poolProxy(
      type,
      url.hostname,
      port,
      name,
      subscriptionId,
      url.username ? decodeName(url.username) : undefined,
      url.password ? decodeName(url.password) : undefined,
    );
  } catch {
    return null;
  }
}

function parseTunnelUri(
  payload: string,
  protocol: string,
  subscriptionId?: string,
): PoolProxy | null {
  const hash = payload.lastIndexOf("#");
  const nameValue = hash >= 0 ? decodeName(payload.slice(hash + 1)) : "";
  const main = (hash >= 0 ? payload.slice(0, hash) : payload).split("?", 1)[0];
  const at = main.lastIndexOf("@");
  const endpoint = parseEndpoint(at >= 0 ? main.slice(at + 1) : main);
  if (!endpoint) return null;
  const userinfo = at >= 0 ? main.slice(0, at) : "";
  const split = userinfo.indexOf(":");
  const name = nameValue || `${protocol}://${endpoint.host}:${endpoint.port}`;
  return poolProxy(
    protocol,
    endpoint.host,
    endpoint.port,
    name,
    subscriptionId,
    userinfo
      ? decodeName(split >= 0 ? userinfo.slice(0, split) : userinfo)
      : undefined,
    split >= 0 ? decodeName(userinfo.slice(split + 1)) : undefined,
  );
}

function finalize(
  proxies: PoolProxy[],
  format: ClashParseResult["format"],
  clashHints?: ClashHints,
): ClashParseResult {
  const cleaned = proxies.filter(
    (proxy) => proxy.host && proxy.port > 0 && proxy.port <= 65535,
  );
  const usableCount = cleaned.filter((proxy) => proxy.usable).length;
  return {
    proxies: cleaned,
    usableCount,
    skippedCount: cleaned.length - usableCount,
    bridgeableCount: cleaned.filter(
      (proxy) => proxy.bridgeable && !proxy.usable,
    ).length,
    format: cleaned.length ? format : "empty",
    clashHints,
  };
}

export function parseSubscriptionBody(
  body: string,
  subscriptionId?: string,
): ClashParseResult {
  const text = decodeBodyLayers(body);
  if (!text) return finalize([], "empty");
  const structured = parseStructured(text, subscriptionId);
  if (structured)
    return finalize(structured.proxies, "clash-yaml", structured.hints);
  const proxies = text.split(/\s+/).flatMap((part) => {
    const proxy = parseProxyUri(part, subscriptionId);
    return proxy ? [proxy] : [];
  });
  return finalize(proxies, "uri-list");
}
