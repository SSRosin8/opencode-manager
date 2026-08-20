import type { ProbeResultCache } from "../proxy/probe.js";
import type { GatewaySettings } from "../settings/store.js";

export type SetupNextAction =
  | "add_proxy_source"
  | "configure_clash_bridge"
  | "run_batch_probe"
  | "review_workers"
  | "ready";

export function setupReadiness(
  settings: GatewaySettings,
  probes: ProbeResultCache,
  readyWorkerCount: number
) {
  const enabledProxies = settings.proxyPool.filter((proxy) => proxy.enabled);
  const bridgeRequired = enabledProxies.some(
    (proxy) => !proxy.usable && proxy.bridgeable
  );
  const testedProxyCount = enabledProxies.filter((proxy) => probes.get(proxy.id)).length;
  const healthyProxyCount = enabledProxies.filter((proxy) => {
    const result = probes.get(proxy.id);
    return Boolean(result?.ok && result.anonymousZen?.ok);
  }).length;
  const enabledWorkerCount = settings.accounts.filter(
    (account) => account.enabled !== false
  ).length;
  let nextAction: SetupNextAction;
  if (readyWorkerCount > 0) nextAction = "ready";
  else if (!enabledProxies.length) {
    nextAction = "add_proxy_source";
  } else if (bridgeRequired && !settings.clashBridge.enabled) {
    nextAction = "configure_clash_bridge";
  } else if (!testedProxyCount || !healthyProxyCount) {
    nextAction = "run_batch_probe";
  } else {
    nextAction = "review_workers";
  }
  return {
    gatewaySecured: Boolean(settings.relayAccessToken),
    proxySourceConfigured: Boolean(enabledProxies.length || settings.proxySubscriptions.length),
    bridgeRequired,
    bridgeEnabled: settings.clashBridge.enabled,
    testedProxyCount,
    healthyProxyCount,
    enabledWorkerCount,
    readyWorkerCount,
    operational: readyWorkerCount > 0,
    nextAction,
  };
}
