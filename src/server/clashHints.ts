import type { GatewaySettings } from "../settings/store.js";

type ClashHints = {
  mixedPort?: number;
  port?: number;
  externalController?: string;
  selectorGroups?: string[];
};

function safeLocalController(value: string): string | null {
  try {
    const parsed = new URL(value.includes("://") ? value : `http://${value}`);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
        !["localhost", "127.0.0.1", "::1"].includes(hostname) ||
        parsed.username || parsed.password || parsed.search || parsed.hash) {
      return null;
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function applyClashHintsToBridge(
  current: GatewaySettings["clashBridge"],
  hints: ClashHints | undefined
): GatewaySettings["clashBridge"] {
  if (!hints) return current;

  const next = { ...current };
  if (hints.mixedPort && Number.isInteger(hints.mixedPort) && hints.mixedPort > 0 && hints.mixedPort <= 65535) {
    next.localProxyPort = hints.mixedPort;
  } else if (hints.port && Number.isInteger(hints.port) && hints.port > 0 && hints.port <= 65535 && !current.enabled) {
    next.localProxyPort = hints.port;
  }
  if (hints.externalController && !current.enabled) {
    const controller = safeLocalController(hints.externalController);
    if (controller) next.apiBase = controller;
  }

  if (hints.selectorGroups?.length) {
    const preferred =
      hints.selectorGroups.find(
        (group) => group === "GLOBAL" || group === "主代理" || group === "Proxy"
      ) ||
      hints.selectorGroups.find(
        (group) =>
          !/netflix|openai|disney|youtube|telegram|spotify|steam|tiktok|apple|google|microsoft|bilibili|bahamut|discord|speedtest|黑名单|中国大陆/i.test(
            group
          )
      ) ||
      hints.selectorGroups[0];
    if (preferred) next.selectorGroup = preferred;
  }

  return next;
}
