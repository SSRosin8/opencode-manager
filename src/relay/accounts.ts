/**
 * Multi-account / multi-key rotation with sticky affinity + 429 cooldown.
 * Stick to one worker until it 429s (or fails), then move to the next ready one.
 * Sticky affinity keeps prompt cache on the same account and improves cache hit rate.
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
  /**
   * Bind this worker to a proxy-pool entry id (preferred).
   * Resolved against GatewaySettings.proxyPool at request time.
   */
  proxyId?: string | null;
  /** Legacy inline proxy; used only when proxyId is unset / not found. */
  proxy?: AccountProxy;
};

export type AccountState = {
  id: string;
  apiKey: string;
  /** Resolved egress proxy for this worker. */
  proxy: AccountProxy;
  /** Pool binding id (for status / debugging). */
  proxyId: string | null;
  /** When set, switch Clash selector to this node before the request. */
  clashNodeName: string | null;
  cooldownUntil: number;
  consecutiveFails: number;
};

const COOLDOWN_BASE_MS = 5_000;
const COOLDOWN_MAX_MS = 60_000;

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
      proxy: null,
      proxyId: null,
      clashNodeName: null,
      cooldownUntil: 0,
      consecutiveFails: 0,
    },
  ];
  private nextIdx = 0;

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
          proxy: null,
          proxyId: null,
          clashNodeName: null,
          cooldownUntil: 0,
          consecutiveFails: 0,
        },
      ];
      this.nextIdx = 0;
      return;
    }

    const previous = new Map(this.accounts.map((a) => [a.id, a] as const));
    this.accounts = configs.map((c) => {
      const prior = previous.get(c.id);
      const egress = resolveFull(c);
      return {
        id: c.id,
        apiKey: c.apiKey ?? "",
        proxy: egress.proxy,
        proxyId: c.proxyId ?? egress.poolId,
        clashNodeName: egress.clashNodeName,
        cooldownUntil: prior?.cooldownUntil ?? 0,
        consecutiveFails: prior?.consecutiveFails ?? 0,
      };
    });
    if (this.nextIdx >= this.accounts.length) this.nextIdx = 0;
  }

  getAccounts(): readonly AccountState[] {
    return this.accounts;
  }

  isReady(account: AccountState, now = Date.now()): boolean {
    return account.cooldownUntil <= now;
  }

  /**
   * Sticky pick: keep returning the same ready account until it cools down
   * (429 / transport failure). Only then advance to the next ready worker.
   * Round-robin would spread consecutive requests across workers and hurt
   * prompt-cache hit rate.
   */
  pick(now = Date.now()): AccountState {
    for (let i = 0; i < this.accounts.length; i++) {
      const idx = (this.nextIdx + i) % this.accounts.length;
      const acct = this.accounts[idx];
      if (this.isReady(acct, now)) {
        // Stick: do not advance past this account while it stays ready.
        this.nextIdx = idx;
        return acct;
      }
    }
    // All in cooldown — stay on preferred index (no thrashing).
    return this.accounts[this.nextIdx % this.accounts.length];
  }

  markCooldown(account: AccountState, now = Date.now(), jitter = Math.random() * 1000): void {
    account.consecutiveFails++;
    const backoff = Math.min(
      COOLDOWN_BASE_MS * Math.pow(2, account.consecutiveFails - 1),
      COOLDOWN_MAX_MS
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
