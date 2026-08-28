import { selectAvailableBridge, type BridgeProbeDiagnostic } from "./bridgeSelector.js";
import type { ClashBridgeConfig, ClashBridgeProfile } from "./pool.js";

export type ResolvedBridge = {
  bridge: ClashBridgeConfig;
  profile: ClashBridgeProfile | null;
  diagnostics: BridgeProbeDiagnostic[];
};

export function bridgeProfiles(config: ClashBridgeConfig): ClashBridgeProfile[] {
  return config.bridges?.length ? config.bridges : [legacyProfile(config)];
}

function legacyProfile(config: ClashBridgeConfig): ClashBridgeProfile {
  return { id: "legacy-clash", name: "Clash bridge", enabled: config.enabled, priority: 0,
    apiBase: config.apiBase, apiSecret: config.apiSecret, localProxyHost: config.localProxyHost,
    localProxyPort: config.localProxyPort, selectorGroup: config.selectorGroup };
}

export function activateBridge(
  config: ClashBridgeConfig,
  profile: ClashBridgeProfile
): ClashBridgeConfig {
  return {
    ...config,
    enabled: config.enabled && profile.enabled,
    apiBase: profile.apiBase,
    apiSecret: profile.apiSecret,
    localProxyHost: profile.localProxyHost,
    localProxyPort: profile.localProxyPort,
    selectorGroup: profile.selectorGroup,
    activeBridgeId: profile.id,
  };
}

export async function resolveBridge(
  config: ClashBridgeConfig,
  targetNode: string | undefined,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<ResolvedBridge> {
  if (!config.enabled) return { bridge: config, profile: null, diagnostics: [] };
  if (config.bridges && config.bridges.length === 0) {
    return { bridge: { ...config, enabled: false }, profile: null, diagnostics: [] };
  }
  if (!config.bridges?.length) {
    return { bridge: config, profile: legacyProfile(config), diagnostics: [] };
  }
  const profiles = bridgeProfiles(config).filter((profile) => profile.enabled);
  if (!profiles.length) return { bridge: { ...config, enabled: false }, profile: null, diagnostics: [] };

  if (config.selectionMode === "manual") {
    const profile = profiles.find((item) => item.id === config.activeBridgeId) ?? profiles[0];
    return { bridge: activateBridge(config, profile), profile, diagnostics: [] };
  }

  const sticky = profiles.find((item) => item.id === config.activeBridgeId);
  const ordered = sticky ? [sticky, ...profiles.filter((item) => item.id !== sticky.id)] : profiles;
  const result = await selectAvailableBridge(ordered, targetNode, fetchImpl);
  if (!result.selected) {
    console.warn(`[bridge] no healthy core (${result.diagnostics.map((item) => `${item.profileId}:${item.ok ? "ok" : "failed"}`).join(",")})`);
    return { bridge: { ...config, enabled: false }, profile: null, diagnostics: result.diagnostics };
  }
  if (result.selected.id !== config.activeBridgeId) {
    console.log(`[bridge] selected core ${result.selected.id}`);
  }
  return {
    bridge: activateBridge(config, result.selected),
    profile: result.selected,
    diagnostics: result.diagnostics,
  };
}
