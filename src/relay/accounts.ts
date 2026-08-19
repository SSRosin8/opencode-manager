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
  /**
   * Bind this worker to a proxy-pool entry id (preferred).
   * Resolved against GatewaySettings.proxyPool at request time.
   */
  proxyId?: string | null;
  /** Legacy inline proxy; used only when proxyId is unset / not found. */
  proxy?: AccountProxy;
};

export type AccountKind = "anonymous_zen" | "authenticated_zen";

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

const TRANSPORT_COOLDOWN_BASE_MS = 5_000;
const TRANSPORT_COOLDOWN_MAX_MS = 60_000;
export const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 15 * 60_000;
const MAX_SESSION_AFFINITIES = 10_000;

export type ResolvedAccountEgress = {
  proxy: AccountProxy;
  clashNodeName: string | null;
  poolId: string | null;
};

export class AccountRotator {
  private accounts: AccountState[] = [
    {
      id: "",
      apiKey: "",
      kind: "anonymous_zen",
      proxy: null,
      proxyId: null,
      clashNodeName: null,
      cooldownUntil: 0,
      consecutiveFails: 0,
    },
  ];
  private nextIdx = 0;
  private sessionAccounts = new Map<string, string>();

  /**
   * Replace account list; preserve cooldown state for matching ids.
   * `resolve` maps each config to effective egress (proxy + optional Clash node).
   */
  sync(
    configs: AccountConfig[],
    resolve?: (config: AccountConfig) => AccountProxy | ResolvedAccountEgress
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

    if (!configs.length) {
      this.accounts = [
        {
          id: "",
          apiKey: "",
          kind: "anonymous_zen",
          proxy: null,
          proxyId: null,
          clashNodeName: null,
          cooldownUntil: 0,
          consecutiveFails: 0,
        },
      ];
      this.nextIdx = 0;
      this.sessionAccounts.clear();
      return;
    }

    const previous = new Map(this.accounts.map((a) => [a.id, a] as const));
    this.accounts = configs.map((c) => {
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
    // Anonymous exits are consumed first; authenticated keys are fallback capacity.
    this.accounts.sort((a, b) =>
      a.kind === b.kind ? 0 : a.kind === "anonymous_zen" ? -1 : 1
    );
    const ids = new Set(this.accounts.map((account) => account.id));
    for (const [sessionKey, accountId] of this.sessionAccounts) {
      if (!ids.has(accountId)) this.sessionAccounts.delete(sessionKey);
    }
    if (this.nextIdx >= this.accounts.length) this.nextIdx = 0;
  }

  getAccounts(): readonly AccountState[] {
    return this.accounts;
  }

  isReady(account: AccountState, now = Date.now()): boolean {
    return account.cooldownUntil <= now;
  }

  private bindSession(sessionKey: string, accountId: string): void {
    this.sessionAccounts.delete(sessionKey);
    this.sessionAccounts.set(sessionKey, accountId);
    if (this.sessionAccounts.size <= MAX_SESSION_AFFINITIES) return;
    const oldest = this.sessionAccounts.keys().next().value as string | undefined;
    if (oldest) this.sessionAccounts.delete(oldest);
  }

  /**
   * Sticky pick: keep returning the same ready account until it cools down
   * (429 / transport failure). Only then advance to the next ready worker.
   * Round-robin would spread consecutive requests across workers and hurt
   * prompt-cache hit rate.
   */
  pick(now?: number): AccountState;
  pick(sessionKey?: string, now?: number): AccountState;
  pick(sessionKeyOrNow: string | number = "", maybeNow = Date.now()): AccountState {
    const sessionKey =
      typeof sessionKeyOrNow === "string" ? sessionKeyOrNow || "__default__" : "__default__";
    const now = typeof sessionKeyOrNow === "number" ? sessionKeyOrNow : maybeNow;
    const boundId = this.sessionAccounts.get(sessionKey);
    if (boundId) {
      const bound = this.accounts.find((account) => account.id === boundId);
      if (bound && this.isReady(bound, now)) return bound;
      this.sessionAccounts.delete(sessionKey);
    }

    const hasReadyAnonymous = this.accounts.some(
      (candidate) => candidate.kind === "anonymous_zen" && this.isReady(candidate, now)
    );
    for (let i = 0; i < this.accounts.length; i++) {
      const idx = (this.nextIdx + i) % this.accounts.length;
      const acct = this.accounts[idx];
      if (hasReadyAnonymous && acct.kind !== "anonymous_zen") continue;
      if (this.isReady(acct, now)) {
        this.nextIdx = (idx + 1) % this.accounts.length;
        this.bindSession(sessionKey, acct.id);
        return acct;
      }
    }
    // All in cooldown — stay on preferred index (no thrashing).
    const account = this.accounts[this.nextIdx % this.accounts.length];
    this.bindSession(sessionKey, account.id);
    return account;
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

  markSuccess(account: AccountState): void {
    account.consecutiveFails = 0;
  }

  /** How many accounts are currently not in cooldown. */
  readyCount(now = Date.now()): number {
    return this.accounts.filter((a) => this.isReady(a, now)).length;
  }
}
