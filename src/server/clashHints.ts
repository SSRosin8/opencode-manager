import type { GatewaySettings } from "../settings/store.js";

type ClashHints = {
  mixedPort?: number;
  port?: number;
  externalController?: string;
  selectorGroups?: string[];
};

export function applyClashHintsToBridge(
  current: GatewaySettings["clashBridge"],
  hints: ClashHints | undefined
): GatewaySettings["clashBridge"] {
  if (!hints) return current;

  const next = { ...current };
  if (hints.mixedPort && hints.mixedPort > 0) {
    next.localProxyPort = hints.mixedPort;
  } else if (hints.port && hints.port > 0 && !current.enabled) {
    next.localProxyPort = hints.port;
  }
  if (hints.externalController) {
    next.apiBase = hints.externalController.replace(/\/+$/, "");
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
