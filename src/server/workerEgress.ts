import { ProbeResultCache, type AnonymousZenProbeResult, type ProbeResult } from "../proxy/probe.js";
import { inferAccountKind } from "../relay/index.js";
import type { GatewaySettings } from "../settings/store.js";

export function attachAnonymousZenResult(
  probe: ProbeResult,
  anonymousZen: AnonymousZenProbeResult | null
): ProbeResult {
  if (!anonymousZen) return { ...probe, anonymousZen: null };
  const health = anonymousZen.ok
    ? "healthy"
    : anonymousZen.status === "rate_limited" || anonymousZen.status === "temporary_failure"
      ? "warn"
      : "bad";
  return { ...probe, health, anonymousZen };
}

export function anonymousZenSummary(results: ProbeResult[]) {
  const summary = {
    usable: 0,
    rateLimited: 0,
    blocked: 0,
    temporaryFailure: 0,
    unreachable: 0,
    unverified: 0,
  };
  for (const result of results) {
    const status = result.anonymousZen?.status;
    if (status === "usable") summary.usable++;
    else if (status === "rate_limited") summary.rateLimited++;
    else if (status === "blocked") summary.blocked++;
    else if (status === "temporary_failure") summary.temporaryFailure++;
    else if (status === "unreachable") summary.unreachable++;
    else summary.unverified++;
  }
  return summary;
}

function autoAnonymousWorkerId(proxyId: string, occupiedIds: Set<string>): string {
  const base = `anonymous-zen-${proxyId}`;
  if (!occupiedIds.has(base)) return base;
  let suffix = 2;
  while (occupiedIds.has(`${base}-${suffix}`)) suffix++;
  return `${base}-${suffix}`;
}

export function syncAnonymousWorkers(
  settings: GatewaySettings,
  results: ProbeResult[],
  probes: ProbeResultCache
): { accounts: GatewaySettings["accounts"]; addedIds: string[] } {
  const accounts = [...settings.accounts];
  const occupiedIds = new Set(accounts.map((account) => account.id));
  const boundProxyIds = new Set(
    accounts
      .filter((account) => inferAccountKind(account) === "anonymous_zen")
      .map((account) => account.proxyId)
      .filter((proxyId): proxyId is string => Boolean(proxyId))
  );
  const usedEgressIps = new Set<string>();
  for (const proxyId of boundProxyIds) {
    const egressIp = probes.get(proxyId)?.egressIp;
    if (egressIp) usedEgressIps.add(egressIp);
  }

  const addedIds: string[] = [];
  for (const result of results) {
    if (!result.ok || !result.anonymousZen?.ok || !result.egressIp) continue;
    if (boundProxyIds.has(result.id) || usedEgressIps.has(result.egressIp)) continue;
    const id = autoAnonymousWorkerId(result.id, occupiedIds);
    accounts.push({
      id,
      kind: "anonymous_zen",
      apiKey: "",
      proxyId: result.id,
      proxy: null,
    });
    occupiedIds.add(id);
    boundProxyIds.add(result.id);
    usedEgressIps.add(result.egressIp);
    addedIds.push(id);
  }
  return { accounts, addedIds };
}

export function duplicateWorkerEgress(
  accounts: GatewaySettings["accounts"],
  probes: ProbeResultCache
): { kind: string; route: string; accountIds: string[] } | null {
  const groups = new Map<string, string[]>();
  for (const account of accounts) {
    if (account.enabled === false || !account.proxyId) continue;
    const route = probes.get(account.proxyId)?.egressIp || `proxy:${account.proxyId}`;
    const kind = inferAccountKind(account);
    const key = `${kind}\0${route}`;
    const ids = groups.get(key) ?? [];
    ids.push(account.id);
    groups.set(key, ids);
    if (ids.length > 1) return { kind, route, accountIds: ids };
  }
  return null;
}

export function credentialLabel(
  kind: "anonymous_zen" | "authenticated_zen",
  apiKey: string
): string {
  if (kind === "anonymous_zen") return "public";
  const key = apiKey.trim();
  if (!key) return "missing key";
  return key.length <= 8
    ? `${key.slice(0, 2)}...${key.slice(-2)}`
    : `${key.slice(0, 4)}...${key.slice(-4)}`;
}
