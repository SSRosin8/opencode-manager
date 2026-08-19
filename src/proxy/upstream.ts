/**
 * Network I/O layer: fetch upstream with per-worker proxy-pool binding,
 * Clash bridge selector switch, sticky multi-key affinity until 429, stream passthrough.
 */

import { fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";
import {
  AccountRotator,
  buildChatCompletionsUrl,
  buildModelsUrl,
  buildUpstreamHeaders,
  transformRequestBody,
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

  constructor(
    settings: GatewaySettings,
    fetchImpl?: ProxyFetch,
    bridgeFetch?: typeof fetch,
    clashQueue?: ClashSwitchQueue
  ) {
    this.settings = settings;
    this.syncFromSettings(settings);
    this.fetchImpl =
      fetchImpl ??
      ((url, init) =>
        undiciFetch(url, init as UndiciRequestInit) as unknown as Promise<Response>);
    this.bridgeFetch = bridgeFetch ?? globalThis.fetch;
    this.clashQueue = clashQueue ?? new ClashSwitchQueue();
  }

  updateSettings(settings: GatewaySettings): void {
    this.settings = settings;
    this.syncFromSettings(settings);
  }

  private syncFromSettings(settings: GatewaySettings): void {
    const pool = settings.proxyPool ?? [];
    const bridge = settings.clashBridge;
    this.rotator.sync(settings.accounts, (c: AccountConfig) =>
      resolveAccountEgress(c, pool, bridge)
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
    if (account.proxyId && !egress.proxy) {
      throw new Error(`Worker "${account.id}" has no usable bound proxy`);
    }
    const transformed = transformRequestBody(
      model,
      {
        model,
        messages: [{ role: "user", content: "Reply exactly OK" }],
        stream: false,
        max_tokens: 16,
      },
      false
    );
    const kind: AccountKind =
      account.kind ?? (account.apiKey.trim() ? "authenticated_zen" : "anonymous_zen");
    const response = await this.doFetch(
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
    if (!proxy?.host || !proxy.port) return undefined;
    try {
      return createProxyDispatcher(proxy);
    } catch {
      return undefined;
    }
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
    /** Stable OpenCode conversation id used for per-session worker affinity. */
    sessionKey?: string;
  }): Promise<UpstreamResult> {
    const model =
      opts.body && typeof opts.body === "object" && !Array.isArray(opts.body)
        ? String((opts.body as Record<string, unknown>).model ?? "")
        : "";
    const transformed = transformRequestBody(model, opts.body, opts.stream);
    const url = buildChatCompletionsUrl(this.settings.baseUrl);
    const maxAttempts = Math.max(1, this.rotator.getAccounts().length);
    let last: UpstreamResult | null = null;
    let lastError: Error | null = null;
    const sessionKey = opts.sessionKey ?? sessionKeyFromHeaders(opts.clientHeaders);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const account = this.rotator.pick(sessionKey);
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
        if (retry) {
          if (retry === "rate_limit") {
            this.rotator.markRateLimited(
              account,
              parseRetryAfterMs(response.headers.get("retry-after"))
            );
          } else {
            this.rotator.markCooldown(account);
          }
          try {
            await response.arrayBuffer();
          } catch {
            /* ignore */
          }
          last.body = null;
          continue;
        }

        this.rotator.markSuccess(account);
        return last;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // Clash/proxy failure → try next worker
        this.rotator.markCooldown(account);
        continue;
      }
    }

    if (last) return last;

    if (this.rotator.getAccounts().every((account) => Boolean(account.proxyId))) {
      throw lastError ?? new Error("All bound worker egress routes failed");
    }

    // Last resort: direct (no proxy) so a misconfigured Clash doesn't total black-hole chat
    try {
      const headers = this.buildHeaders(
        effectiveApiKey(
          this.rotator.getAccounts()[0]?.apiKey || "",
          this.rotator.getAccounts()[0]?.kind ?? "anonymous_zen"
        ),
        opts.stream,
        opts.clientHeaders
      );
      const response = await this.rawFetch(
        url,
        { method: "POST", headers, body: JSON.stringify(transformed) },
        null
      );
      return {
        status: response.status,
        headers: response.headers,
        body: response.body,
        accountId: "direct-fallback",
        proxyId: null,
        clashNodeName: null,
      };
    } catch {
      throw lastError ?? new Error("All upstream chat attempts failed");
    }
  }

  /**
   * Models list: prefer success over sticky proxy.
   * 1) Try each worker (with Clash if bound)
   * 2) Fall back to direct GET (OpenCode models often works without account proxy)
   */
  async listModels(clientHeaders?: Record<string, string>): Promise<UpstreamResult> {
    const url = buildModelsUrl(this.settings.baseUrl);
    const maxAttempts = Math.max(1, this.rotator.getAccounts().length);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const account = this.rotator.pick("__models__");
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
        if (retry) {
          if (retry === "rate_limit") {
            this.rotator.markRateLimited(
              account,
              parseRetryAfterMs(response.headers.get("retry-after"))
            );
          } else {
            this.rotator.markCooldown(account);
          }
          try {
            await response.arrayBuffer();
          } catch {
            /* ignore */
          }
          continue;
        }

        // Proxy path returned something HTTP-shaped — pass through (even 401/403)
        if (response.status < 500) {
          if (response.ok) this.rotator.markSuccess(account);
          return {
            status: response.status,
            headers: response.headers,
            body: response.body,
            accountId: account.id,
            proxyId: account.proxyId,
            clashNodeName: account.clashNodeName,
          };
        }

        // 5xx via proxy → try next / direct
        try {
          await response.arrayBuffer();
        } catch {
          /* ignore */
        }
        this.rotator.markCooldown(account);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.rotator.markCooldown(account);
      }
    }

    if (this.rotator.getAccounts().every((account) => Boolean(account.proxyId))) {
      throw lastError ?? new Error("All bound worker egress routes failed");
    }

    // Direct fallback is allowed only when at least one worker is intentionally unbound.
    const headers = this.buildHeaders(
      effectiveApiKey(
        this.rotator.getAccounts()[0]?.apiKey || "",
        this.rotator.getAccounts()[0]?.kind ?? "anonymous_zen"
      ),
      false,
      clientHeaders
    );
    headers["Accept"] = "application/json";

    try {
      const response = await this.rawFetch(url, { method: "GET", headers }, null);
      return {
        status: response.status,
        headers: response.headers,
        body: response.body,
        accountId: "direct-fallback",
        proxyId: null,
        clashNodeName: null,
      };
    } catch (err) {
      const message =
        (err instanceof Error ? err.message : String(err)) ||
        lastError?.message ||
        "models fetch failed";
      throw new Error(
        lastError ? `${message} (also: ${lastError.message})` : message
      );
    }
  }
}
