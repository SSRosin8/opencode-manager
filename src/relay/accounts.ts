/**
 * Multi-account / multi-key rotation with per-session affinity + 429 cooldown.
 * Stick each session to one worker until it 429s (or fails), then move to the next ready one.
 * Affinity keeps prompt cache on the same account and improves cache hit rate.
 * Adapted from OmniRoute open-sse/executors/opencode.ts account state machine.
 */

export type AccountProxy = {
  type: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
} | null;

export type AccountConfig = {
  /** Stable id (fingerprint / label). Empty string = default direct account. */
  id: string;
  /** Bearer API key for this account (may be empty for keyless free tier). */
  apiKey: string;
  /** Worker pool. Legacy configs infer anonymous from an empty key. */
  kind?: AccountKind;
  /** Disabled workers remain configured but never receive relay traffic. */
  enabled?: boolean;
  /**
   * Bind this worker to a proxy-pool entry id (preferred).
   * Resolved against GatewaySettings.proxyPool at request time.
   */
  proxyId?: string | null;
  /** Legacy inline proxy; used only when proxyId is unset / not found. */
  proxy?: AccountProxy;
};

export type AccountKind = "anonymous_zen" | "authenticated_zen";

export type WorkerRoutingStrategy =
  | "anonymous_first"
  | "authenticated_first"
  | "mixed";

export function inferAccountKind(config: Pick<AccountConfig, "apiKey" | "kind">): AccountKind {
  if (config.kind === "anonymous_zen" || config.kind === "authenticated_zen") {
    return config.kind;
  }
  return config.apiKey?.trim() ? "authenticated_zen" : "anonymous_zen";
}

export type AccountState = {
  id: string;
  apiKey: string;
  kind: AccountKind;
  /** Resolved egress proxy for this worker. */
  proxy: AccountProxy;
  /** Pool binding id (for status / debugging). */
  proxyId: string | null;
  /** When set, switch Clash selector to this node before the request. */
  clashNodeName: string | null;
  cooldownUntil: number;
  consecutiveFails: number;
};

/** Session → worker binding with bind time (for TTL expiry on restore). */
export type SessionBinding = {
  accountId: string;
  at: number;
};

/** Persisted affinity entry: routing key (session id or blob hash). */
export type PersistedAffinityEntry = {
  key: string;
  accountId: string;
  at: number;
};

export type SessionAffinitySnapshot = {
  sessions: PersistedAffinityEntry[];
  blobs: PersistedAffinityEntry[];
};

/** Persistence hook: hosts save routing-only mappings (no message content). */
export type SessionAffinitySink = {
  save(snapshot: SessionAffinitySnapshot): void;
};

const TRANSPORT_COOLDOWN_BASE_MS = 5_000;
const TRANSPORT_COOLDOWN_MAX_MS = 60_000;
export const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 15 * 60_000;
const MAX_SESSION_AFFINITIES = 10_000;
/** Cap for the encrypted-reasoning fingerprint → worker hint index. */
const MAX_BLOB_WORKERS = 5_000;
/** Session/blob bindings older than this are dropped on restore. */
export const DEFAULT_SESSION_AFFINITY_TTL_MS = 24 * 60 * 60 * 1_000;

export type ResolvedAccountEgress = {
  proxy: AccountProxy;
  clashNodeName: string | null;
  poolId: string | null;
};

export class AccountRotator {
  private accounts: AccountState[] = [];
  private nextIdx = 0;
  private sessionAccounts = new Map<string, SessionBinding>();
  /** Encrypted-reasoning fingerprint → issuing worker hint index. */
  private blobWorkers = new Map<string, SessionBinding>();
  private strategy: WorkerRoutingStrategy = "anonymous_first";
  /** Fired on binding changes so hosts can persist affinity (throttled). */
  onAffinityChange?: () => void;

  /**
   * Replace account list; preserve cooldown state for matching ids.
   * `resolve` maps each config to effective egress (proxy + optional Clash node).
   */
  sync(
    configs: AccountConfig[],
    resolve?: (config: AccountConfig) => AccountProxy | ResolvedAccountEgress,
    strategy: WorkerRoutingStrategy = "anonymous_first"
  ): void {
    const resolveFull = (
      c: AccountConfig
    ): ResolvedAccountEgress => {
      if (!resolve) {
        return { proxy: c.proxy ?? null, clashNodeName: null, poolId: c.proxyId ?? null };
      }
      const r = resolve(c);
      if (r && typeof r === "object" && "proxy" in r && "clashNodeName" in r) {
        return r as ResolvedAccountEgress;
      }
      return {
        proxy: (r as AccountProxy) ?? null,
        clashNodeName: null,
        poolId: c.proxyId ?? null,
      };
    };

    const previous = new Map(this.accounts.map((a) => [a.id, a] as const));
    this.accounts = configs.filter((c) => c.enabled !== false).map((c) => {
      const prior = previous.get(c.id);
      const egress = resolveFull(c);
      return {
        id: c.id,
        apiKey: c.apiKey ?? "",
        kind: inferAccountKind(c),
        proxy: egress.proxy,
        proxyId: c.proxyId ?? egress.poolId,
        clashNodeName: egress.clashNodeName,
        cooldownUntil: prior?.cooldownUntil ?? 0,
        consecutiveFails: prior?.consecutiveFails ?? 0,
      };
    });
    if (strategy !== "mixed") {
      const preferred =
        strategy === "authenticated_first" ? "authenticated_zen" : "anonymous_zen";
      this.accounts.sort((a, b) =>
        a.kind === b.kind ? 0 : a.kind === preferred ? -1 : 1
      );
    }
    if (this.strategy !== strategy) {
      this.sessionAccounts.clear();
      this.nextIdx = 0;
    }
    this.strategy = strategy;
    const ids = new Set(this.accounts.map((account) => account.id));
    for (const [sessionKey, binding] of this.sessionAccounts) {
      if (!ids.has(binding.accountId)) this.sessionAccounts.delete(sessionKey);
    }
    if (this.nextIdx >= this.accounts.length) this.nextIdx = 0;
  }

  getAccounts(): readonly AccountState[] {
    return this.accounts;
  }

  isReady(account: AccountState, now = Date.now()): boolean {
    return account.cooldownUntil <= now;
  }

  private bindSession(sessionKey: string, accountId: string, now: number): void {
    this.sessionAccounts.delete(sessionKey);
    this.sessionAccounts.set(sessionKey, { accountId, at: now });
    if (this.sessionAccounts.size <= MAX_SESSION_AFFINITIES) {
      this.notifyAffinityChange();
      return;
    }
    const oldest = this.sessionAccounts.keys().next().value as string | undefined;
    if (oldest) this.sessionAccounts.delete(oldest);
    this.notifyAffinityChange();
  }

  private notifyAffinityChange(): void {
    try {
      this.onAffinityChange?.();
    } catch {
      // Persistence must never alter routing.
    }
  }

  /** Drop one session binding so its next turn re-picks a worker. */
  unbindSession(sessionKey?: string): void {
    const key = sessionKey || "__default__";
    if (this.sessionAccounts.delete(key)) this.notifyAffinityChange();
  }

  /** Routing-only snapshot for disk persistence (no message content). */
  snapshotSessions(): PersistedAffinityEntry[] {
    return [...this.sessionAccounts.entries()].map(([key, binding]) => ({
      key,
      accountId: binding.accountId,
      at: binding.at,
    }));
  }

  snapshotBlobs(): PersistedAffinityEntry[] {
    return [...this.blobWorkers.entries()].map(([key, binding]) => ({
      key,
      accountId: binding.accountId,
      at: binding.at,
    }));
  }

  private restoreEntries(
    target: Map<string, SessionBinding>,
    entries: PersistedAffinityEntry[] | undefined,
    cap: number,
    now: number,
    ttlMs: number
  ): void {
    if (!entries) return;
    for (const entry of entries.slice(0, cap)) {
      if (!entry || typeof entry.key !== "string" || !entry.key) continue;
      if (typeof entry.accountId !== "string" || !entry.accountId) continue;
      if (typeof entry.at !== "number" || !Number.isFinite(entry.at)) continue;
      if (!this.accounts.some((account) => account.id === entry.accountId)) continue;
      if (entry.at > now || now - entry.at > ttlMs) continue;
      if (!target.has(entry.key)) {
        target.set(entry.key, { accountId: entry.accountId, at: entry.at });
      }
    }
    while (target.size > cap) {
      const oldest = target.keys().next().value as string | undefined;
      if (!oldest) break;
      target.delete(oldest);
    }
  }

  /** Re-apply persisted bindings (boot); drops expired or orphaned entries. */
  restoreSessions(
    entries: PersistedAffinityEntry[] | undefined,
    now = Date.now(),
    ttlMs = DEFAULT_SESSION_AFFINITY_TTL_MS
  ): void {
    this.restoreEntries(this.sessionAccounts, entries, MAX_SESSION_AFFINITIES, now, ttlMs);
  }

  restoreBlobs(
    entries: PersistedAffinityEntry[] | undefined,
    now = Date.now(),
    ttlMs = DEFAULT_SESSION_AFFINITY_TTL_MS
  ): void {
    this.restoreEntries(this.blobWorkers, entries, MAX_BLOB_WORKERS, now, ttlMs);
  }

  /**
   * Remember which worker served requests carrying these encrypted-reasoning
   * fingerprints. Successful service implies the provider accepted the blobs
   * there, so later keyless turns carrying the same blobs prefer it.
   */
  learnBlobWorkers(hashes: string[], accountId: string, now = Date.now()): void {
    if (!hashes.length) return;
    if (!this.accounts.some((account) => account.id === accountId)) return;
    for (const hash of hashes) {
      if (typeof hash !== "string" || !hash) continue;
      this.blobWorkers.delete(hash);
      this.blobWorkers.set(hash, { accountId, at: now });
    }
    while (this.blobWorkers.size > MAX_BLOB_WORKERS) {
      const oldest = this.blobWorkers.keys().next().value as string | undefined;
      if (!oldest) break;
      this.blobWorkers.delete(oldest);
    }
    this.notifyAffinityChange();
  }

  /**
   * Drop encrypted-reasoning hints that pointed at the wrong worker. Used
   * when a turn fails as caller-bound stale reasoning: keeping the mapping
   * would route the next turn carrying the same blobs back to the failure.
   */
  forgetBlobWorkers(hashes: string[]): void {
    if (!hashes.length) return;
    let changed = false;
    for (const hash of hashes) {
      if (this.blobWorkers.delete(hash)) changed = true;
    }
    if (changed) this.notifyAffinityChange();
  }

  /**
   * Hint worker for keyless turns carrying known encrypted reasoning.
   * Returns a worker only on a unanimous, fresh mapping to a ready account.
   */
  findBlobWorker(
    hashes: string[],
    now = Date.now(),
    ttlMs = DEFAULT_SESSION_AFFINITY_TTL_MS
  ): AccountState | null {
    if (!hashes.length) return null;
    let candidate: string | null = null;
    for (const hash of hashes) {
      const entry = this.blobWorkers.get(hash);
      if (!entry || entry.at > now || now - entry.at > ttlMs) return null;
      if (candidate === null) candidate = entry.accountId;
      else if (candidate !== entry.accountId) return null;
    }
    if (!candidate) return null;
    const account = this.accounts.find((item) => item.id === candidate);
    return account && this.isReady(account, now) ? account : null;
  }

  /**
   * Strict sticky pick: a bound session keeps its worker while that worker is
   * ready, even when a routing-strategy-preferred worker becomes available.
   * Preempting mid-conversation breaks callers that bind encrypted reasoning
   * (thinking signatures / encrypted_content) to the issuing worker identity.
   * The routing strategy still applies to new bindings and to re-picks after
   * the bound worker cools down (429 / auth / transport failure).
   */
  pick(now?: number): AccountState;
  pick(sessionKey?: string, now?: number): AccountState;
  pick(sessionKeyOrNow: string | number = "", maybeNow = Date.now()): AccountState {
    if (!this.accounts.length) throw new Error("No enabled workers configured");
    const sessionKey =
      typeof sessionKeyOrNow === "string" ? sessionKeyOrNow || "__default__" : "__default__";
    const now = typeof sessionKeyOrNow === "number" ? sessionKeyOrNow : maybeNow;
    return this.pickWithHint(sessionKey, [], now);
  }

  /**
   * Session-aware pick with an encrypted-reasoning fallback hint. Unbound
   * sessions whose request carries known blobs go to the worker that served
   * those blobs before; everything else follows strict stickiness + strategy.
   */
  pickWithHint(sessionKey: string, blobHashes: string[], now = Date.now()): AccountState {
    if (!this.accounts.length) throw new Error("No enabled workers configured");
    const key = sessionKey || "__default__";
    const preferredKind =
      this.strategy === "anonymous_first"
        ? "anonymous_zen"
        : this.strategy === "authenticated_first"
          ? "authenticated_zen"
          : null;
    const hasReadyPreferred = preferredKind
      ? this.accounts.some(
          (candidate) => candidate.kind === preferredKind && this.isReady(candidate, now)
        )
      : false;
    const boundId = this.sessionAccounts.get(key)?.accountId;
    if (boundId) {
      const bound = this.accounts.find((account) => account.id === boundId);
      if (bound && this.isReady(bound, now)) {
        return bound;
      }
      this.sessionAccounts.delete(key);
    } else if (blobHashes.length) {
      const hinted = this.findBlobWorker(blobHashes, now);
      if (hinted) {
        this.bindSession(key, hinted.id, now);
        return hinted;
      }
    }

    for (let i = 0; i < this.accounts.length; i++) {
      const idx = (this.nextIdx + i) % this.accounts.length;
      const acct = this.accounts[idx];
      if (hasReadyPreferred && acct.kind !== preferredKind) continue;
      if (this.isReady(acct, now)) {
        this.nextIdx = (idx + 1) % this.accounts.length;
        this.bindSession(key, acct.id, now);
        return acct;
      }
    }
    // All in cooldown — return the one recovering soonest instead of the
    // round-robin slot, so retries converge instead of hammering one worker.
    let earliest = this.accounts[0];
    for (const account of this.accounts) {
      if (account.cooldownUntil < earliest.cooldownUntil) earliest = account;
    }
    this.bindSession(key, earliest.id, now);
    return earliest;
  }

  markCooldown(account: AccountState, now = Date.now(), jitter = Math.random() * 1000): void {
    account.consecutiveFails++;
    const backoff = Math.min(
      TRANSPORT_COOLDOWN_BASE_MS * Math.pow(2, account.consecutiveFails - 1),
      TRANSPORT_COOLDOWN_MAX_MS
    );
    account.cooldownUntil = now + backoff + jitter;
  }

  markRateLimited(
    account: AccountState,
    retryAfterMs = DEFAULT_RATE_LIMIT_COOLDOWN_MS,
    now = Date.now()
  ): void {
    account.consecutiveFails++;
    account.cooldownUntil = now + Math.max(0, retryAfterMs);
  }

  /**
   * Auth failures (bad/rotated key) are config errors, not rate limits.
   * Use a short backoff so a bad key neither spins hot nor disappears for
   * 15 minutes and hides the misconfiguration.
   */
  markAuthFailed(account: AccountState, now = Date.now(), jitter = Math.random() * 1000): void {
    account.consecutiveFails++;
    const backoff = Math.min(
      TRANSPORT_COOLDOWN_BASE_MS * Math.pow(2, Math.min(account.consecutiveFails, 4) - 1),
      TRANSPORT_COOLDOWN_MAX_MS
    );
    account.cooldownUntil = now + backoff + jitter;
  }

  markSuccess(account: AccountState): void {
    account.consecutiveFails = 0;
  }

  /** How many accounts are currently not in cooldown. */
  readyCount(now = Date.now()): number {
    return this.accounts.filter((a) => this.isReady(a, now)).length;
  }
}
