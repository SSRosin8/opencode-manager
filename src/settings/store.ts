/**
 * Simple file-backed settings store for admin-managed gateway config.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  DEFAULT_BASE_URL,
  inferAccountKind,
  type AccountConfig,
  type AccountProxy,
  type WorkerRoutingStrategy,
} from "../relay/index.js";
import {
  DEFAULT_CLASH_BRIDGE,
  normalizeClashBridge,
  normalizePoolProxy,
  normalizeProxyPool,
  normalizeSubscriptions,
  type ClashBridgeConfig,
  type PoolProxy,
  type ProxySubscription,
} from "../proxy/pool.js";

export type GatewaySettings = {
  baseUrl: string;
  /** Optional token required in X-OC-Relay-Key for public /v1/* requests. */
  relayAccessToken: string;
  /** When true, synthesize OpenCode CLI identity headers if client omitted them. */
  synthesizeCliHeaders: boolean;
  cliUserAgent: string;
  cliClient: string;
  cliProject: string;
  accounts: AccountConfig[];
  /** Controls which enabled Zen worker pool is exhausted first. */
  routingStrategy: WorkerRoutingStrategy;
  /** Shared proxy pool — workers bind via account.proxyId. */
  proxyPool: PoolProxy[];
  /** Clash subscription sources that feed the proxy pool. */
  proxySubscriptions: ProxySubscription[];
  /** Local Clash/Mihomo bridge for vless/hy2/tuic nodes. */
  clashBridge: ClashBridgeConfig;
  /** Optional gateway listen port override (env PORT still wins at boot). */
  port: number;
};

export type RuntimeStatus = {
  running: boolean;
  startedAt: string | null;
  baseUrl: string;
  accountCount: number;
  enabledAccountCount: number;
  readyAccountCount: number;
  proxyPoolCount: number;
  proxyPoolUsable: number;
  proxyPoolBridgeable: number;
  clashBridgeEnabled: boolean;
  subscriptionCount: number;
  lastRequestAt: string | null;
  lastRequestPath: string | null;
  lastRequestStatus: number | null;
  lastError: string | null;
  recentErrors: Array<{ at: string; message: string; path?: string }>;
  recentGatewayRejections: GatewayRejectionEvent[];
};

export type GatewayRejectionEvent = {
  requestId: string;
  at: string;
  method: string;
  path: string;
  status: number;
  type: string;
  model?: string;
  stage: "gateway";
};

export type GatewayRejectionInput = {
  method: string;
  path: string;
  status: number;
  type: string;
  model?: string;
};

const MAX_RECENT_GATEWAY_REJECTIONS = 50;

function safeEventText(value: string, maxLength: number): string {
  return value.replace(/[\r\n\t]/g, " ").trim().slice(0, maxLength);
}

function safeEventPath(path: string): string {
  return safeEventText(path.split(/[?#]/, 1)[0] || "/", 200) || "/";
}

function safeEventModel(model: string): string {
  const value = safeEventText(model.split(/[?#]/, 1)[0], 120);
  if (/^(?:bearer|key|sk|token)[-_ :]/i.test(value)) return "[redacted]";
  return value;
}

const DEFAULT_SETTINGS: GatewaySettings = {
  baseUrl: DEFAULT_BASE_URL,
  relayAccessToken: "",
  synthesizeCliHeaders: false,
  cliUserAgent: "opencode-cli/1.0.0",
  cliClient: "cli",
  cliProject: "default",
  accounts: [{
    id: "default",
    apiKey: "",
    kind: "anonymous_zen",
    enabled: true,
    proxyId: null,
    proxy: null,
  }],
  routingStrategy: "anonymous_first",
  proxyPool: [],
  proxySubscriptions: [],
  clashBridge: { ...DEFAULT_CLASH_BRIDGE },
  port: 9876,
};

function defaultDataPath(): string {
  return resolve(process.cwd(), "data", "settings.json");
}

function normalizeProxy(raw: unknown): AccountProxy {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.host !== "string" || typeof p.port !== "number") return null;
  return {
    type: typeof p.type === "string" ? p.type : "http",
    host: p.host,
    port: p.port,
    username: typeof p.username === "string" ? p.username : undefined,
    password: typeof p.password === "string" ? p.password : undefined,
  };
}

function normalizeAccounts(raw: unknown): AccountConfig[] {
  if (!Array.isArray(raw)) {
    return [{
      id: "default",
      apiKey: "",
      kind: "anonymous_zen",
      enabled: true,
      proxyId: null,
      proxy: null,
    }];
  }
  // An explicit empty list is meaningful: operators may remove every Worker
  // and let a later batch proxy test repopulate anonymous Zen Workers.
  if (raw.length === 0) return [];
  return raw.map((item, i) => {
    const a = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const proxyId =
      typeof a.proxyId === "string" && a.proxyId
        ? a.proxyId
        : a.proxyId === null
          ? null
          : null;
    return {
      id: typeof a.id === "string" && a.id ? a.id : `account-${i + 1}`,
      apiKey: typeof a.apiKey === "string" ? a.apiKey : "",
      kind: inferAccountKind({
        apiKey: typeof a.apiKey === "string" ? a.apiKey : "",
        kind:
          a.kind === "anonymous_zen" || a.kind === "authenticated_zen"
            ? a.kind
            : undefined,
      }),
      enabled: a.enabled !== false,
      proxyId,
      proxy: normalizeProxy(a.proxy),
    };
  });
}

export function normalizeSettings(raw: Partial<GatewaySettings> | null | undefined): GatewaySettings {
  const s = raw ?? {};
  return {
    baseUrl:
      typeof s.baseUrl === "string" && s.baseUrl.trim()
        ? s.baseUrl.trim().replace(/\/+$/, "")
        : DEFAULT_BASE_URL,
    relayAccessToken:
      typeof s.relayAccessToken === "string" ? s.relayAccessToken.trim() : "",
    synthesizeCliHeaders: Boolean(s.synthesizeCliHeaders),
    cliUserAgent:
      typeof s.cliUserAgent === "string" && s.cliUserAgent.trim()
        ? s.cliUserAgent.trim()
        : DEFAULT_SETTINGS.cliUserAgent,
    cliClient:
      typeof s.cliClient === "string" && s.cliClient.trim()
        ? s.cliClient.trim()
        : DEFAULT_SETTINGS.cliClient,
    cliProject:
      typeof s.cliProject === "string" && s.cliProject.trim()
        ? s.cliProject.trim()
        : DEFAULT_SETTINGS.cliProject,
    accounts: normalizeAccounts(s.accounts),
    routingStrategy:
      s.routingStrategy === "authenticated_first" || s.routingStrategy === "mixed"
        ? s.routingStrategy
        : "anonymous_first",
    proxyPool: normalizeProxyPool(s.proxyPool),
    proxySubscriptions: normalizeSubscriptions(s.proxySubscriptions),
    clashBridge: normalizeClashBridge(s.clashBridge),
    port: typeof s.port === "number" && s.port > 0 && s.port < 65536 ? s.port : DEFAULT_SETTINGS.port,
  };
}

export class SettingsStore {
  readonly path: string;
  private settings: GatewaySettings;
  private status: RuntimeStatus;
  private mutationChain: Promise<void> = Promise.resolve();

  constructor(path = process.env.OPENCODE_MANAGER_SETTINGS_PATH || defaultDataPath()) {
    this.path = path;
    this.settings = structuredClone(DEFAULT_SETTINGS);
    this.status = {
      running: false,
      startedAt: null,
      baseUrl: this.settings.baseUrl,
      accountCount: this.settings.accounts.length,
      enabledAccountCount: this.settings.accounts.filter(
        (account) => account.enabled !== false
      ).length,
      readyAccountCount: this.settings.accounts.length,
      proxyPoolCount: 0,
      proxyPoolUsable: 0,
      proxyPoolBridgeable: 0,
      clashBridgeEnabled: false,
      subscriptionCount: 0,
      lastRequestAt: null,
      lastRequestPath: null,
      lastRequestStatus: null,
      lastError: null,
      recentErrors: [],
      recentGatewayRejections: [],
    };
  }

  get(): GatewaySettings {
    return structuredClone(this.settings);
  }

  getStatus(): RuntimeStatus {
    return structuredClone(this.status);
  }

  setRunning(running: boolean): void {
    this.status.running = running;
    if (running && !this.status.startedAt) {
      this.status.startedAt = new Date().toISOString();
    }
  }

  recordRequest(path: string, status: number, error?: string): void {
    this.status.lastRequestAt = new Date().toISOString();
    this.status.lastRequestPath = path;
    this.status.lastRequestStatus = status;
    if (error) {
      this.status.lastError = error;
      this.status.recentErrors.unshift({
        at: this.status.lastRequestAt,
        message: error,
        path,
      });
      this.status.recentErrors = this.status.recentErrors.slice(0, 20);
    }
  }

  recordGatewayRejection(input: GatewayRejectionInput): void {
    const at = new Date().toISOString();
    const path = safeEventPath(input.path);
    const type = safeEventText(input.type, 80) || "request_rejected";
    const method = safeEventText(input.method.toUpperCase(), 12) || "UNKNOWN";
    const model = input.model ? safeEventModel(input.model) : "";
    const event: GatewayRejectionEvent = {
      requestId: randomUUID(),
      at,
      method,
      path,
      status: input.status,
      type,
      ...(model ? { model } : {}),
      stage: "gateway",
    };

    this.status.lastRequestAt = at;
    this.status.lastRequestPath = path;
    this.status.lastRequestStatus = input.status;
    this.status.lastError = `gateway rejected: ${type}`;
    this.status.recentErrors.unshift({ at, message: this.status.lastError, path });
    this.status.recentErrors = this.status.recentErrors.slice(0, 20);
    this.status.recentGatewayRejections.unshift(event);
    this.status.recentGatewayRejections = this.status.recentGatewayRejections.slice(
      0,
      MAX_RECENT_GATEWAY_REJECTIONS
    );
  }

  /** Clear transient request/error history without changing gateway settings. */
  clearRequestHistory(): void {
    this.status.lastRequestAt = null;
    this.status.lastRequestPath = null;
    this.status.lastRequestStatus = null;
    this.status.lastError = null;
    this.status.recentErrors = [];
    this.status.recentGatewayRejections = [];
  }

  updateReadyCount(ready: number, total: number): void {
    this.status.readyAccountCount = ready;
    this.status.enabledAccountCount = total;
    this.syncStatusFromSettings();
  }

  async load(): Promise<GatewaySettings> {
    try {
      const text = await readFile(this.path, "utf8");
      const parsed = JSON.parse(text) as Partial<GatewaySettings>;
      this.settings = normalizeSettings(parsed);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        console.warn(`[settings] failed to load ${this.path}:`, err);
      }
      this.settings = normalizeSettings(null);
    }
    this.syncStatusFromSettings();
    return this.get();
  }

  async save(partial: Partial<GatewaySettings>): Promise<GatewaySettings> {
    return this.update((current) => ({ ...current, ...partial }));
  }

  /** Atomically derive and persist a mutation from the latest saved settings. */
  update(
    builder: (current: GatewaySettings) => Partial<GatewaySettings>
  ): Promise<GatewaySettings> {
    return this.enqueueMutation(builder);
  }

  async addManualProxy(input: Partial<PoolProxy> & { host: string; port: number }): Promise<GatewaySettings> {
    const entry = normalizePoolProxy({
      ...input,
      source: "manual",
      enabled: input.enabled !== false,
      usable: true,
      bridgeable: true,
    });
    if (!entry) {
      throw new Error("Invalid proxy: host and port required");
    }
    entry.source = "manual";
    entry.usable = true;
    entry.bridgeable = true;
    entry.enabled = input.enabled !== false;
    return this.enqueueMutation((current) => ({
      ...current,
      proxyPool: [...current.proxyPool, entry],
    }));
  }

  async removeProxy(id: string): Promise<GatewaySettings> {
    return this.enqueueMutation((current) => ({
      ...current,
      proxyPool: current.proxyPool.filter((p) => p.id !== id),
      accounts: current.accounts.map((a) =>
        a.proxyId === id ? { ...a, proxyId: null } : a
      ),
    }));
  }

  async removeAllProxies(): Promise<GatewaySettings> {
    return this.enqueueMutation((current) => ({
      ...current,
      proxyPool: [],
      accounts: current.accounts.map((account) =>
        account.proxyId ? { ...account, proxyId: null } : account
      ),
    }));
  }

  private enqueueMutation(
    build: (current: GatewaySettings) => Partial<GatewaySettings>
  ): Promise<GatewaySettings> {
    const job = this.mutationChain.then(async () => {
      const current = this.get();
      const next = normalizeSettings({ ...current, ...build(current) });
      await this.persist(next);
      this.settings = next;
      this.syncStatusFromSettings();
      return this.get();
    });
    this.mutationChain = job.then(
      () => undefined,
      () => undefined
    );
    return job;
  }

  private async persist(settings = this.settings): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(settings, null, 2), "utf8");
  }

  private syncStatusFromSettings(): void {
    this.status.baseUrl = this.settings.baseUrl;
    this.status.accountCount = this.settings.accounts.length;
    this.status.enabledAccountCount = this.settings.accounts.filter(
      (account) => account.enabled !== false
    ).length;
    this.status.proxyPoolCount = this.settings.proxyPool.length;
    this.status.proxyPoolUsable = this.settings.proxyPool.filter(
      (p) => p.enabled && p.usable
    ).length;
    this.status.proxyPoolBridgeable = this.settings.proxyPool.filter(
      (p) => p.enabled && !p.usable && p.bridgeable
    ).length;
    this.status.clashBridgeEnabled = Boolean(this.settings.clashBridge?.enabled);
    this.status.subscriptionCount = this.settings.proxySubscriptions.length;
  }
}
