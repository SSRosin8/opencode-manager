/**
 * Network I/O layer: fetch upstream with per-worker proxy-pool binding,
 * Clash bridge selector switch, sticky multi-key affinity until 429, stream passthrough.
 */

import { fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";
import { randomUUID } from "node:crypto";
import {
  AccountRotator,
  buildChatCompletionsUrl,
  buildResponsesUrl,
  buildModelsUrl,
  buildUpstreamHeaders,
  transformRequestBody,
  transformResponsesRequestBody,
  type AccountConfig,
  type AccountProxy,
} from "../relay/index.js";
import type { AccountKind } from "../relay/accounts.js";
import type { GatewaySettings } from "../settings/store.js";
import { resolveAccountEgress } from "./pool.js";
import { createProxyDispatcher } from "./dispatcher.js";
import { ClashSwitchQueue, selectClashProxy } from "./clashBridge.js";

export type UpstreamResult = {
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
  accountId: string;
  proxyId: string | null;
  clashNodeName: string | null;
};

export type ProxyFetch = (
  url: string,
  init: RequestInit & { dispatcher?: unknown }
) => Promise<Response>;

export type UpstreamAttemptEvent = {
  requestId: string;
  operation: "chat" | "responses" | "models" | "test";
  accountId: string;
  accountKind: AccountKind;
  proxyId: string | null;
  clashNodeName: string | null;
  model: string | null;
  attempt: number;
  maxAttempts: number;
  status: number | null;
  outcome:
    | "success"
    | "rate_limited"
    | "auth_failed"
    | "upstream_error"
    | "transport_error";
  error: string | null;
  latencyMs: number;
  willRetry: boolean;
  at: string;
};

export type UpstreamAttemptObserver = (
  event: UpstreamAttemptEvent
) => void | Promise<void>;

function responseOutcome(status: number): UpstreamAttemptEvent["outcome"] {
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "auth_failed";
  if (status >= 200 && status < 300) return "success";
  return "upstream_error";
}

function safeErrorMessage(error: unknown, apiKey: string): string {
  let message = error instanceof Error ? error.message : String(error);
  if (apiKey) message = message.split(apiKey).join("[REDACTED]");
  message = message.replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]");
  return message.slice(0, 500);
}

function effectiveApiKey(apiKey: string, kind: AccountKind): string {
  return kind === "anonymous_zen" ? "public" : apiKey;
}

export function parseRetryAfterMs(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return undefined;
  return Math.max(0, at - now);
}

function retryableStatus(status: number): "rate_limit" | "failure" | null {
  if (status === 429 || status === 401 || status === 403) return "rate_limit";
  if (status >= 500) return "failure";
  return null;
}

function sessionKeyFromHeaders(headers?: Record<string, string>): string | undefined {
  if (!headers) return undefined;
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if ((lower === "x-session-id" || lower === "x-opencode-session") && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

export class UpstreamClient {
  readonly rotator = new AccountRotator();
  private settings: GatewaySettings;
  private fetchImpl: ProxyFetch;
  private clashQueue: ClashSwitchQueue;
  private bridgeFetch: typeof fetch;
  private attemptObserver?: UpstreamAttemptObserver;

  constructor(
    settings: GatewaySettings,
    fetchImpl?: ProxyFetch,
    bridgeFetch?: typeof fetch,
    clashQueue?: ClashSwitchQueue,
    attemptObserver?: UpstreamAttemptObserver
  ) {
    this.settings = settings;
    this.syncFromSettings(settings);
    this.fetchImpl =
      fetchImpl ??
      ((url, init) =>
        undiciFetch(url, init as UndiciRequestInit) as unknown as Promise<Response>);
    this.bridgeFetch = bridgeFetch ?? globalThis.fetch;
    this.clashQueue = clashQueue ?? new ClashSwitchQueue();
    this.attemptObserver = attemptObserver;
  }

  setAttemptObserver(observer?: UpstreamAttemptObserver): void {
    this.attemptObserver = observer;
  }

  private emitAttempt(event: UpstreamAttemptEvent): void {
    try {
      const pending = this.attemptObserver?.(event);
      if (pending && typeof pending.catch === "function") pending.catch(() => undefined);
    } catch {
      // Observability must never alter proxy behavior.
    }
  }

  updateSettings(settings: GatewaySettings): void {
    this.settings = settings;
    this.syncFromSettings(settings);
  }

  private syncFromSettings(settings: GatewaySettings): void {
    const pool = settings.proxyPool ?? [];
    const bridge = settings.clashBridge;
    this.rotator.sync(
      settings.accounts,
      (c: AccountConfig) => resolveAccountEgress(c, pool, bridge),
      settings.routingStrategy
    );
  }

  syncAccounts(accounts: AccountConfig[]): void {
    this.settings = { ...this.settings, accounts };
    this.syncFromSettings(this.settings);
  }

  /** Send one real request through exactly one configured worker without rotation/cooldown changes. */
  async testAccountConnection(
    accountId: string,
    model: string
  ): Promise<UpstreamResult> {
    const account = this.settings.accounts.find((item) => item.id === accountId);
    if (!account) throw new Error(`Worker not found: ${accountId}`);
    const egress = resolveAccountEgress(
      account,
      this.settings.proxyPool ?? [],
      this.settings.clashBridge
    );
    const transformed = transformRequestBody(
      model,
      {
        model,
        messages: [{ role: "user", content: "x" }],
        stream: false,
        max_tokens: 1,
      },
      false
    );
    const kind: AccountKind =
      account.kind ?? (account.apiKey.trim() ? "authenticated_zen" : "anonymous_zen");
    const requestId = randomUUID();
    const startedAt = Date.now();
    let response: Response;
    try {
      if (account.proxyId && !egress.proxy) {
        throw new Error(`Worker "${account.id}" has no usable bound proxy`);
      }
      response = await this.doFetch(
        buildChatCompletionsUrl(this.settings.baseUrl),
        {
          method: "POST",
          headers: this.buildHeaders(effectiveApiKey(account.apiKey, kind), false),
          body: JSON.stringify(transformed),
          signal: AbortSignal.timeout(45_000),
        },
        egress.proxy,
        egress.clashNodeName
      );
      this.emitAttempt({
        requestId,
        operation: "test",
        accountId: account.id,
        accountKind: kind,
        proxyId: account.proxyId ?? egress.poolId,
        clashNodeName: egress.clashNodeName,
        model,
        attempt: 1,
        maxAttempts: 1,
        status: response.status,
        outcome: responseOutcome(response.status),
        error: response.ok ? null : `Upstream returned HTTP ${response.status}`,
        latencyMs: Date.now() - startedAt,
        willRetry: false,
        at: new Date().toISOString(),
      });
    } catch (error) {
      this.emitAttempt({
        requestId,
        operation: "test",
        accountId: account.id,
        accountKind: kind,
        proxyId: account.proxyId ?? egress.poolId,
        clashNodeName: egress.clashNodeName,
        model,
        attempt: 1,
        maxAttempts: 1,
        status: null,
        outcome: "transport_error",
        error: safeErrorMessage(error, account.apiKey),
        latencyMs: Date.now() - startedAt,
        willRetry: false,
        at: new Date().toISOString(),
      });
      throw error;
    }
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
      accountId: account.id,
      proxyId: account.proxyId ?? egress.poolId,
      clashNodeName: egress.clashNodeName,
    };
  }

  private dispatcherFor(proxy: AccountProxy) {
    if (!proxy) return undefined;
    if (!proxy.host || !proxy.port) throw new Error("Invalid proxy configuration");
    return createProxyDispatcher(proxy);
  }

  private async rawFetch(
    url: string,
    init: RequestInit,
    proxy: AccountProxy
  ): Promise<Response> {
    const dispatcher = this.dispatcherFor(proxy);
    if (dispatcher) {
      return this.fetchImpl(url, { ...init, dispatcher });
    }
    return this.fetchImpl(url, init);
  }

  /**
   * Fetch via worker egress. Clash switch failures throw so callers can rotate.
   * When `skipClashSwitch` is true, only the local HTTP proxy is used (if any).
   */
  private async doFetch(
    url: string,
    init: RequestInit,
    proxy: AccountProxy,
    clashNodeName: string | null,
    opts?: { skipClashSwitch?: boolean }
  ): Promise<Response> {
    const needSwitch =
      !opts?.skipClashSwitch &&
      Boolean(clashNodeName && this.settings.clashBridge?.enabled);

    const run = async () => {
      if (needSwitch && clashNodeName) {
        await selectClashProxy(
          this.settings.clashBridge,
          clashNodeName,
          this.bridgeFetch
        );
      }
      return this.rawFetch(url, init, proxy);
    };

    if (needSwitch) {
      return this.clashQueue.run(run);
    }
    return run();
  }

  private buildHeaders(
    apiKey: string,
    stream: boolean,
    clientHeaders?: Record<string, string>
  ): Record<string, string> {
    const headers = buildUpstreamHeaders({
      apiKey,
      stream,
      clientHeaders,
      synthesizeCliHeaders: this.settings.synthesizeCliHeaders,
      cliDefaults: {
        userAgent: this.settings.cliUserAgent,
        client: this.settings.cliClient,
        project: this.settings.cliProject,
      },
    });
    if (!stream) {
      // Prefer JSON for models / non-stream
      if (!headers["Accept"]) headers["Accept"] = "application/json";
    }
    return headers;
  }

  async chatCompletions(opts: {
    body: unknown;
    stream: boolean;
    clientHeaders?: Record<string, string>;
    protocol?: "chat" | "responses";
    /** Stable OpenCode conversation id used for per-session worker affinity. */
    sessionKey?: string;
  }): Promise<UpstreamResult> {
    if (!this.rotator.getAccounts().length) {
      throw new Error("No enabled workers configured");
    }
    const model =
      opts.body && typeof opts.body === "object" && !Array.isArray(opts.body)
        ? String((opts.body as Record<string, unknown>).model ?? "")
        : "";
    const operation = opts.protocol ?? "chat";
    const transformed = operation === "responses"
      ? transformResponsesRequestBody(model, opts.body, opts.stream)
      : transformRequestBody(model, opts.body, opts.stream);
    const url = operation === "responses"
      ? buildResponsesUrl(this.settings.baseUrl)
      : buildChatCompletionsUrl(this.settings.baseUrl);
    const maxAttempts = Math.max(1, this.rotator.getAccounts().length);
    const requestId = randomUUID();
    let last: UpstreamResult | null = null;
    let lastError: Error | null = null;
    const sessionKey = opts.sessionKey ?? sessionKeyFromHeaders(opts.clientHeaders);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const account = this.rotator.pick(sessionKey);
      const startedAt = Date.now();
      const headers = this.buildHeaders(
        effectiveApiKey(account.apiKey, account.kind),
        opts.stream,
        opts.clientHeaders
      );

      try {
        if (account.proxyId && !account.proxy) {
          throw new Error(`Worker "${account.id}" has no usable bound proxy`);
        }
        const response = await this.doFetch(
          url,
          {
            method: "POST",
            headers,
            body: JSON.stringify(transformed),
          },
          account.proxy,
          account.clashNodeName
        );

        last = {
          status: response.status,
          headers: response.headers,
          body: response.body,
          accountId: account.id,
          proxyId: account.proxyId,
          clashNodeName: account.clashNodeName,
        };

        const retry = retryableStatus(response.status);
        this.emitAttempt({
          requestId,
          operation,
          accountId: account.id,
          accountKind: account.kind,
          proxyId: account.proxyId,
          clashNodeName: account.clashNodeName,
          model: model || null,
          attempt: attempt + 1,
          maxAttempts,
          status: response.status,
          outcome: responseOutcome(response.status),
          error: response.ok ? null : `Upstream returned HTTP ${response.status}`,
          latencyMs: Date.now() - startedAt,
          willRetry: Boolean(retry && attempt + 1 < maxAttempts),
          at: new Date().toISOString(),
        });
        if (retry) {
          if (retry === "rate_limit") {
            this.rotator.markRateLimited(
              account,
              parseRetryAfterMs(response.headers.get("retry-after"))
            );
          } else {
            this.rotator.markCooldown(account);
          }
          if (attempt + 1 < maxAttempts) {
            try {
              await response.body?.cancel();
            } catch {
              /* ignore */
            }
            last.body = null;
          }
          continue;
        }

        this.rotator.markSuccess(account);
        return last;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.emitAttempt({
          requestId,
          operation,
          accountId: account.id,
          accountKind: account.kind,
          proxyId: account.proxyId,
          clashNodeName: account.clashNodeName,
          model: model || null,
          attempt: attempt + 1,
          maxAttempts,
          status: null,
          outcome: "transport_error",
          error: safeErrorMessage(err, account.apiKey),
          latencyMs: Date.now() - startedAt,
          willRetry: attempt + 1 < maxAttempts,
          at: new Date().toISOString(),
        });
        // Clash/proxy failure → try next worker
        this.rotator.markCooldown(account);
        continue;
      }
    }

    if (last) return last;

    throw lastError ?? new Error("All upstream chat attempts failed");
  }

  /**
   * Models list: prefer success over sticky proxy.
   * 1) Try each worker (with Clash if bound)
   * Unbound workers are already direct routes and participate in the same loop.
   */
  async listModels(clientHeaders?: Record<string, string>): Promise<UpstreamResult> {
    if (!this.rotator.getAccounts().length) {
      throw new Error("No enabled workers configured");
    }
    const url = buildModelsUrl(this.settings.baseUrl);
    const maxAttempts = Math.max(1, this.rotator.getAccounts().length);
    const requestId = randomUUID();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const account = this.rotator.pick("__models__");
      const startedAt = Date.now();
      const headers = this.buildHeaders(
        effectiveApiKey(account.apiKey, account.kind),
        false,
        clientHeaders
      );
      // models: Accept application/json (not SSE)
      headers["Accept"] = "application/json";

      try {
        if (account.proxyId && !account.proxy) {
          throw new Error(`Worker "${account.id}" has no usable bound proxy`);
        }
        const response = await this.doFetch(
          url,
          { method: "GET", headers },
          account.proxy,
          account.clashNodeName
        );

        const retry = retryableStatus(response.status);
        this.emitAttempt({
          requestId,
          operation: "models",
          accountId: account.id,
          accountKind: account.kind,
          proxyId: account.proxyId,
          clashNodeName: account.clashNodeName,
          model: null,
          attempt: attempt + 1,
          maxAttempts,
          status: response.status,
          outcome: responseOutcome(response.status),
          error: response.ok ? null : `Upstream returned HTTP ${response.status}`,
          latencyMs: Date.now() - startedAt,
          willRetry: Boolean(retry && attempt + 1 < maxAttempts),
          at: new Date().toISOString(),
        });
        if (retry) {
          if (retry === "rate_limit") {
            this.rotator.markRateLimited(
              account,
              parseRetryAfterMs(response.headers.get("retry-after"))
            );
          } else {
            this.rotator.markCooldown(account);
          }
          if (attempt + 1 < maxAttempts) {
            try {
              await response.body?.cancel();
            } catch {
              /* ignore */
            }
            continue;
          }
          return {
            status: response.status,
            headers: response.headers,
            body: response.body,
            accountId: account.id,
            proxyId: account.proxyId,
            clashNodeName: account.clashNodeName,
          };
        }

        if (response.ok) this.rotator.markSuccess(account);
        return {
          status: response.status,
          headers: response.headers,
          body: response.body,
          accountId: account.id,
          proxyId: account.proxyId,
          clashNodeName: account.clashNodeName,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.emitAttempt({
          requestId,
          operation: "models",
          accountId: account.id,
          accountKind: account.kind,
          proxyId: account.proxyId,
          clashNodeName: account.clashNodeName,
          model: null,
          attempt: attempt + 1,
          maxAttempts,
          status: null,
          outcome: "transport_error",
          error: safeErrorMessage(err, account.apiKey),
          latencyMs: Date.now() - startedAt,
          willRetry: attempt + 1 < maxAttempts,
          at: new Date().toISOString(),
        });
        this.rotator.markCooldown(account);
      }
    }

    throw lastError ?? new Error("All upstream model attempts failed");
  }
}
