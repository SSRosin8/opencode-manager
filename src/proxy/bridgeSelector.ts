import type { ClashBridgeProfile } from "./pool.js";
export type { ClashBridgeProfile } from "./pool.js";

export type BridgeProbeDiagnostic = {
  profileId: string;
  name: string;
  ok: boolean;
  reason: string;
  version?: string;
  groups?: string[];
};

export type BridgeSelectionResult = {
  selected: ClashBridgeProfile | null;
  diagnostics: BridgeProbeDiagnostic[];
};

type ControllerProxy = {
  type?: unknown;
  all?: unknown;
};

const DEFAULT_TIMEOUT_MS = 5_000;

async function request(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    return await fetchImpl(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function profileName(profile: ClashBridgeProfile): string {
  return profile.name.trim() || profile.id;
}

export type BridgeDataPlaneProbe = (
  profile: ClashBridgeProfile,
) => Promise<{ ok: boolean; reason?: string }>;

/**
 * Probe one bridge without changing its selector. `/proxies` is authoritative
 * for selector validation; `/version` is optional because some compatible
 * controllers expose only the proxy API.
 */
export async function probeBridgeProfile(
  profile: ClashBridgeProfile,
  targetNode?: string,
  fetchImpl: typeof fetch = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<BridgeProbeDiagnostic> {
  const base = profile.apiBase.replace(/\/+$/, "");
  const headers: Record<string, string> = {};
  if (profile.apiSecret) headers.Authorization = `Bearer ${profile.apiSecret}`;
  let version: string | undefined;
  let versionError: string | undefined;
  try {
    const response = await request(fetchImpl, `${base}/version`, headers, timeoutMs);
    if (response.ok) {
      const body = (await response.json().catch(() => ({}))) as { version?: unknown };
      if (typeof body.version === "string") version = body.version;
    } else {
      versionError = `version HTTP ${response.status}`;
      await response.text().catch(() => "");
    }
  } catch (error) {
    versionError = error instanceof Error ? error.message : String(error);
  }

  try {
    const response = await request(fetchImpl, `${base}/proxies`, headers, timeoutMs);
    if (!response.ok) {
      await response.text().catch(() => "");
      return {
        profileId: profile.id,
        name: profileName(profile),
        ok: false,
        reason: `proxies HTTP ${response.status}${versionError ? `; ${versionError}` : ""}`,
        version,
      };
    }
    const body = (await response.json().catch(() => null)) as
      | { proxies?: Record<string, ControllerProxy> }
      | null;
    const proxies = body?.proxies;
    if (!proxies || typeof proxies !== "object") {
      return { profileId: profile.id, name: profileName(profile), ok: false, reason: "invalid /proxies response", version };
    }
    const selector = proxies[profile.selectorGroup];
    const groups = Object.entries(proxies)
      .filter(([, value]) => value?.type === "Selector")
      .map(([name]) => name);
    if (!selector || selector.type !== "Selector" || !Array.isArray(selector.all)) {
      return {
        profileId: profile.id,
        name: profileName(profile),
        ok: false,
        reason: `selector group "${profile.selectorGroup}" not found`,
        version,
        groups,
      };
    }
    const normalizedTarget = targetNode?.trim().toLocaleLowerCase();
    const normalizedNodes = selector.all
      .filter((node): node is string => typeof node === "string")
      .map((node) => node.trim().toLocaleLowerCase());
    if (normalizedTarget && !normalizedNodes.includes(normalizedTarget)) {
      return {
        profileId: profile.id,
        name: profileName(profile),
        ok: false,
        reason: `target node "${targetNode}" not in selector group`,
        version,
        groups,
      };
    }
    return {
      profileId: profile.id,
      name: profileName(profile),
      ok: true,
      reason: versionError ? `ready via /proxies (${versionError})` : "ready",
      version,
      groups,
    };
  } catch (error) {
    return {
      profileId: profile.id,
      name: profileName(profile),
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      version,
    };
  }
}

/** Pick the highest-priority healthy bridge, preserving input order on ties. */
export async function selectAvailableBridge(
  profiles: readonly ClashBridgeProfile[],
  targetNode?: string,
  fetchImpl: typeof fetch = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  probeDataPlane?: BridgeDataPlaneProbe,
): Promise<BridgeSelectionResult> {
  const diagnostics: BridgeProbeDiagnostic[] = [];
  const candidates = profiles
    .filter((profile) => profile.enabled)
    .map((profile, index) => ({ profile, index }))
    .sort((left, right) => (left.profile.priority ?? 0) - (right.profile.priority ?? 0) || left.index - right.index)
    .map(({ profile }) => profile);
  for (const profile of candidates) {
    const diagnostic = await probeBridgeProfile(profile, targetNode, fetchImpl, timeoutMs);
    diagnostics.push(diagnostic);
    if (!diagnostic.ok) continue;
    if (probeDataPlane) {
      try {
        const dataPlane = await probeDataPlane(profile);
        if (!dataPlane.ok) {
          diagnostic.ok = false;
          diagnostic.reason = dataPlane.reason || "local proxy data plane unavailable";
          continue;
        }
      } catch (error) {
        diagnostic.ok = false;
        diagnostic.reason = error instanceof Error ? error.message : String(error);
        continue;
      }
    }
    return { selected: profile, diagnostics };
  }
  return { selected: null, diagnostics };
}
