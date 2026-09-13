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
  containsStaleReasoningMessage,
  DEFAULT_SESSION_AFFINITY_TTL_MS,
  extractEncryptedBlobHashes,
  isStaleReasoningError,
  resolveSessionKey,
  transformRequestBody,
  transformResponsesRequestBody,
  type AccountConfig,
  type AccountProxy,
  type PersistedAffinityEntry,
  type SessionAffinitySink,
  type SessionAffinitySnapshot,
} from "../relay/index.js";
import type { AccountKind } from "../relay/accounts.js";
import type { GatewaySettings } from "../settings/store.js";
import { resolveAccountEgress } from "./pool.js";
import { createProxyDispatcher } from "./dispatcher.js";
import { ClashSwitchQueue, selectClashProxy } from "./clashBridge.js";
import { activateBridge, resolveBridge } from "./bridgeRuntime.js";

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

function safeErrorMessage(error: unknown, apiKey: string, proxy?: AccountProxy): string {
  let message = error instanceof Error ? error.message : String(error);
  if (apiKey) message = message.split(apiKey).join("[REDACTED]");
  message = message.replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]");
  // Proxy credentials can surface in dispatcher/connect errors; strip them.
  if (proxy?.password) message = message.split(proxy.password).join("[REDACTED]");
  if (proxy?.username) message = message.split(proxy.username).join("[REDACTED]");
  message = message.replace(/:\/\/[^/\s@]+@/g, "://[REDACTED]@");
  message = message.replace(/([?&](?:token|key|api[-_]?key|secret|password)=)[^&\s]+/gi, "$1[REDACTED]");
  return message.slice(0, 500);
}

/** Error text returned to API clients must not include credentials or tokenized URLs. */
export function sanitizeUpstreamError(error: unknown): string {
  return safeErrorMessage(error, "");
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

function retryableStatus(status: number): "rate_limit" | "auth" | "failure" | null {
  if (status === 429) return "rate_limit";
  // Bad/rotated keys are config errors: retry other workers but cool down
  // briefly instead of applying the 15-minute rate-limit penalty.
  if (status === 401 || status === 403) return "auth";
  if (status >= 500) return "failure";
  return null;
}

// Bound every upstream attempt so a hung provider cannot hold gateway
// connections (and Clash selector slots) indefinitely.
const UPSTREAM_REQUEST_TIMEOUT_MS = 120_000;

// Only small error bodies are peeked for stale-reasoning classification;
// anything larger passes through untouched but stays byte-identical.
const MAX_ERROR_PEEK_BYTES = 32 * 1024;

/** Error payload shapes worth peeking (plain JSON or SSE-wrapped errors). */
const PEEKABLE_ERROR_CONTENT_TYPES = ["application/json", "text/event-stream"];

function concatBytes(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  let size = 0;
  for (const chunk of chunks) size += chunk.byteLength;
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/** Minimum gap between affinity snapshot persists (change hook is hot). */
const AFFINITY_SAVE_MIN_INTERVAL_MS = 5_000;

export class UpstreamClient {
  readonly rotator = new AccountRotator();
  private settings: GatewaySettings;
  private fetchImpl: ProxyFetch;
  private clashQueue: ClashSwitchQueue;
  private bridgeFetch: typeof fetch;
  private attemptObserver?: UpstreamAttemptObserver;
  private affinitySink: SessionAffinitySink | null;
  private affinityLastSave = 0;

  constructor(
    settings: GatewaySettings,
    fetchImpl?: ProxyFetch,
    bridgeFetch?: typeof fetch,
    clashQueue?: ClashSwitchQueue,
    attemptObserver?: UpstreamAttemptObserver,
    affinitySink?: SessionAffinitySink | null
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
    this.affinitySink = affinitySink ?? null;
    this.rotator.onAffinityChange = () => this.scheduleAffinitySave();
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

  /**
   * Re-apply persisted affinity after boot. Entries naming removed workers
   * or older than the TTL are dropped by the rotator.
   */
  restoreAffinity(
    snapshot: SessionAffinitySnapshot | { sessions?: PersistedAffinityEntry[]; blobs?: PersistedAffinityEntry[] },
    now = Date.now(),
    ttlMs = DEFAULT_SESSION_AFFINITY_TTL_MS
  ): void {
    this.rotator.restoreSessions(snapshot?.sessions, now, ttlMs);
    this.rotator.restoreBlobs(snapshot?.blobs, now, ttlMs);
  }

  private scheduleAffinitySave(now = Date.now()): void {
    const sink = this.affinitySink;
    if (!sink || now - this.affinityLastSave < AFFINITY_SAVE_MIN_INTERVAL_MS) return;
    this.affinityLastSave = now;
    try {
      sink.save({
        sessions: this.rotator.snapshotSessions(),
        blobs: this.rotator.snapshotBlobs(),
      });
    } catch {
      // Persistence must never break relay traffic.
    }
  }

  /**
   * Persist affinity immediately, bypassing the change throttle. Best-effort
   * hook for graceful shutdown: throttled saves can otherwise lag restarts
   * and drop the newest bindings, which re-picks sessions onto new workers.
   */
  flushAffinity(): void {
    const sink = this.affinitySink;
    if (!sink) return;
    this.affinityLastSave = Date.now();
    try {
      sink.save({
        sessions: this.rotator.snapshotSessions(),
        blobs: this.rotator.snapshotBlobs(),
      });
    } catch {
      // Persistence must never break shutdown.
    }
  }

  /**
   * Settle blob affinity after a streamed body was piped downstream. HTTP 200
   * proves nothing by itself: caller-bound reasoning rejections can arrive
   * embedded in the SSE payload, in which case learning the blobs would pin
   * future turns to the failing worker.
   */
  settleStreamBlobs(opts: {
    body: unknown;
    clientHeaders?: Record<string, string>;
    protocol?: "chat" | "responses";
    accountId: string;
    status: number;
    sseText: string;
  }): void {
    const blobHashes = extractEncryptedBlobHashes(opts.body);
    if (!blobHashes.length) return;
    if (containsStaleReasoningMessage(opts.sseText)) {
      const sessionKey = resolveSessionKey({
        clientHeaders: opts.clientHeaders,
        body: opts.body,
        protocol: opts.protocol,
      });
      this.rotator.unbindSession(sessionKey ?? "");
      this.rotator.forgetBlobWorkers(blobHashes);
      return;
    }
    if (opts.status >= 200 && opts.status < 300) {
      this.rotator.learnBlobWorkers(blobHashes, opts.accountId);
    }
  }

  /**
   * Peek at small 400 bodies to recognize stale encrypted reasoning.
   * Returns the original response untouched unless it was buffered, in which
   * case an equivalent rebuilt response is returned for downstream piping.
   */
  private async peekStaleReasoningError(
    response: Response
  ): Promise<{ stale: boolean; response: Response }> {
    const passthrough = { stale: false, response };
    try {
      if (response.status !== 400) return passthrough;
      const contentType = response.headers.get("content-type") ?? "";
      if (!PEEKABLE_ERROR_CONTENT_TYPES.some((known) => contentType.includes(known))) {
        return passthrough;
      }
      const declared = Number(response.headers.get("content-length") ?? "");
      // Fast path: honestly-sized bodies buffer in one shot.
      if (Number.isFinite(declared) && declared > 0 && declared <= MAX_ERROR_PEEK_BYTES) {
        // Classify on text but rebuild from the original bytes so the
        // downstream body stays bit-identical even for non-UTF8 payloads.
        const bytes = await response.arrayBuffer();
        const rebuilt = new Response(bytes, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
        return { stale: isStaleReasoningError(response.status, new TextDecoder().decode(bytes)), response: rebuilt };
      }
      // Slow path: missing or untrusted length (chunked). Bounded peek so a
      // misbehaving upstream cannot force unbounded buffering here.
      const peeked = await this.peekBoundedErrorBody(response);
      if (!peeked || peeked.bytes === null) {
        return peeked ? { stale: false, response: peeked.response } : passthrough;
      }
      return {
        stale: isStaleReasoningError(response.status, new TextDecoder().decode(peeked.bytes)),
        response: peeked.response,
      };
    } catch {
      return passthrough;
    }
  }

  /**
   * Buffer an error body up to the peek budget and rebuild an equivalent
   * response. Over-budget bodies replay the buffered prefix and keep
   * streaming the remainder, so downstream stays complete (`bytes` is null).
   */
  private async peekBoundedErrorBody(
    response: Response
  ): Promise<{ bytes: Uint8Array<ArrayBuffer> | null; response: Response } | null> {
    if (!response.body) return null;
    const meta = {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    };
    let reader: ReadableStreamDefaultReader<Uint8Array>;
    try {
      reader = response.body.getReader();
    } catch {
      return null;
    }
    const release = (): void => {
      try {
        reader.releaseLock();
      } catch {
        // A released or errored reader needs no further cleanup.
      }
    };
    const chunks: Uint8Array[] = [];
    let size = 0;
    let done = false;
    try {
      while (!done && size <= MAX_ERROR_PEEK_BYTES) {
        const next = await reader.read();
        done = next.done;
        if (next.value) {
          chunks.push(next.value);
          size += next.value.byteLength;
        }
      }
    } catch {
      release();
      return null;
    }
    const prefix = concatBytes(chunks);
    if (done && size <= MAX_ERROR_PEEK_BYTES) {
      release();
      return { bytes: prefix, response: new Response(prefix, meta) };
    }
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(prefix);
        if (done) {
          controller.close();
          release();
          return;
        }
        void (async () => {
          try {
            for (;;) {
              const next = await reader.read();
              if (next.done) break;
              if (next.value) controller.enqueue(next.value);
            }
            controller.close();
          } catch (error) {
            controller.error(error);
          } finally {
            release();
          }
        })();
      },
    });
    return { bytes: null, response: new Response(stream, meta) };
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
        error: safeErrorMessage(error, account.apiKey, egress.proxy),
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
    // Never follow redirects with Authorization attached: a hijacked baseUrl
    // could otherwise 302 the Bearer key to an attacker domain.
    const noRedirect: RequestInit = { ...init, redirect: "manual" };
    const dispatcher = this.dispatcherFor(proxy);
    if (dispatcher) {
      return this.fetchImpl(url, { ...noRedirect, dispatcher });
    }
    return this.fetchImpl(url, noRedirect);
  }

  /**
   * Fetch via worker egress. Clash switch failures throw so callers can rotate.
   * When `skipClashSwitch` is true, only the local HTTP proxy is used (if any).
   * Multi-bridge: controller nodes are routed via their owning bridge's
   * mixed-port/selector. We first try to identify the owning bridge via the
   * egress proxy's host:port (which is per-bridge) or via pool's bridgeId,
   * then fall back to the legacy auto-selection.
   */
  private async doFetch(
    url: string,
    init: RequestInit,
    proxy: AccountProxy,
    clashNodeName: string | null,
    opts?: { skipClashSwitch?: boolean }
  ): Promise<Response> {
    let bridge = this.settings.clashBridge;
    if (clashNodeName && bridge.enabled) {
      let targetBridge: typeof bridge | null = null;
      // Prefer proxy host:port to identify owning bridge (controller nodes).
      if (proxy) {
        const currentProxy = proxy;
        const bridges = (bridge as { bridges?: typeof bridge.bridges }).bridges ?? [];
        const matched = bridges.find(
          (profile) => profile.localProxyHost === currentProxy.host && profile.localProxyPort === currentProxy.port
        );
        if (matched && matched.enabled) {
          targetBridge = activateBridge(bridge, matched);
        }
      }
      // Fallback: search pool for the node to obtain its bridgeId
      if (!targetBridge) {
        const poolEntry = this.settings.proxyPool.find(
          (entry) => (entry.clashNodeName === clashNodeName || entry.name === clashNodeName) && entry.bridgeId
        );
        if (poolEntry?.bridgeId) {
          const bridges = (bridge as { bridges?: typeof bridge.bridges }).bridges ?? [];
          const profile = bridges.find((item) => item.id === poolEntry.bridgeId);
          if (profile && profile.enabled) {
            targetBridge = activateBridge(bridge, profile);
          }
        }
      }
      if (targetBridge) {
        bridge = targetBridge;
        // Keep the original proxy (already per-bridge); do not rewrite.
      } else {
        const resolved = await resolveBridge(bridge, clashNodeName, this.bridgeFetch);
        bridge = resolved.bridge;
        proxy = {
          type: "http",
          host: bridge.localProxyHost,
          port: bridge.localProxyPort,
        };
        if (!resolved.profile) {
          throw new Error(`No healthy Clash bridge contains node "${clashNodeName}"`);
        }
      }
    }
    const needSwitch =
      !opts?.skipClashSwitch &&
      Boolean(clashNodeName && bridge.enabled);

    const run = async () => {
      if (needSwitch && clashNodeName) {
        await selectClashProxy(
          bridge,
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
    const sessionKey = resolveSessionKey({
      sessionKey: opts.sessionKey,
      clientHeaders: opts.clientHeaders,
      body: opts.body,
      protocol: operation,
    });
    const blobHashes = extractEncryptedBlobHashes(opts.body);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const account = this.rotator.pickWithHint(sessionKey ?? "", blobHashes);
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
            signal: AbortSignal.timeout(UPSTREAM_REQUEST_TIMEOUT_MS),
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
          } else if (retry === "auth") {
            this.rotator.markAuthFailed(account);
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

        if (response.status === 400) {
          const checked = await this.peekStaleReasoningError(response);
          last = {
            status: checked.response.status,
            headers: checked.response.headers,
            body: checked.response.body,
            accountId: account.id,
            proxyId: account.proxyId,
            clashNodeName: account.clashNodeName,
          };
          if (checked.stale) {
            // The session history replays reasoning issued to another caller;
            // keeping the binding (or marking success) would pin every future
            // turn to the same failure. Drop the binding and the wrong blob
            // hints, then surface the upstream error so the client starts a
            // fresh turn.
            this.rotator.unbindSession(sessionKey ?? "");
            this.rotator.forgetBlobWorkers(blobHashes);
            return last;
          }
        }

        // Only successful service proves the worker accepts these blobs.
        // Streams settle after the body is piped downstream: an SSE-embedded
        // rejection still arrives with HTTP 200 (see settleStreamBlobs).
        if (!opts.stream && last.status >= 200 && last.status < 300 && blobHashes.length) {
          this.rotator.learnBlobWorkers(blobHashes, account.id);
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
          error: safeErrorMessage(err, account.apiKey, account.proxy),
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
          { method: "GET", headers, signal: AbortSignal.timeout(UPSTREAM_REQUEST_TIMEOUT_MS) },
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
          } else if (retry === "auth") {
            this.rotator.markAuthFailed(account);
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
          error: safeErrorMessage(err, account.apiKey, account.proxy),
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
