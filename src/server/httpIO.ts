import type { IncomingMessage, ServerResponse } from "node:http";
import type { UpstreamClient } from "../proxy/upstream.js";
import type { SettingsStore } from "../settings/store.js";

export const DEFAULT_MAX_UPSTREAM_RESPONSE_BYTES = 8 * 1024 * 1024;

export class UpstreamResponseTooLargeError extends Error {
  constructor(readonly limit: number) {
    super("Upstream response exceeded the configured size limit");
    this.name = "UpstreamResponseTooLargeError";
  }
}

export const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "content-encoding",
  "content-length",
]);

/**
 * Read a client request without imposing a gateway-specific payload cap.
 * OpenCode/Zen is responsible for accepting or rejecting multimodal payloads.
 * Admin/management routes must use readJsonBody() with an explicit limit.
 */
export function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    req.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buffer);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    req.on("error", (error) => {
      reject(error);
    });
  });
}

export class AdminBodyTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`Admin request body exceeded the ${limit} byte limit`);
    this.name = "AdminBodyTooLargeError";
  }
}

/** Bounded body reader for admin/management JSON. Relay passthrough stays unbounded. */
export function readJsonBody(req: IncomingMessage, maxBytes = 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let rejected = false;
    const onData = (chunk: unknown): void => {
      if (rejected) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      size += buffer.length;
      if (size > maxBytes) {
        rejected = true;
        req.removeListener("data", onData);
        // Drain without accumulating so the socket can be reused/closed cleanly.
        req.resume();
        reject(new AdminBodyTooLargeError(maxBytes));
        return;
      }
      chunks.push(buffer);
    };
    req.on("data", onData);
    req.on("end", () => {
      if (!rejected) resolve(Buffer.concat(chunks, size));
    });
    req.on("error", (error) => {
      if (!rejected) reject(error);
    });
  });
}

export function clientHeadersFrom(req: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null || key.toLowerCase() === "x-oc-relay-key") continue;
    headers[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return headers;
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

/**
 * Read an admin/management body with a bound. Returns null after sending 413
 * so handlers can `if (!raw) return true;` without duplicating error mapping.
 * Relay passthrough must keep using readBody() (unbounded multimodal).
 */
export async function readAdminBody(
  req: IncomingMessage,
  res: ServerResponse,
  maxBytes = 1024 * 1024
): Promise<Buffer | null> {
  try {
    return await readJsonBody(req, maxBytes);
  } catch (err) {
    if (err instanceof AdminBodyTooLargeError) {
      sendJson(res, 413, {
        error: { message: err.message, type: "body_too_large" },
      });
      return null;
    }
    throw err;
  }
}

export function rejectUnavailableWorkerPool(
  res: ServerResponse,
  store: SettingsStore,
  path: string,
  method: string
): boolean {
  const accounts = store.get().accounts;
  if (accounts.some((account) => account.enabled !== false)) return false;

  const empty = accounts.length === 0;
  const message = empty
    ? "No Zen workers are configured. Add a Worker or run a batch proxy test to create anonymous Workers."
    : "All configured Zen workers are disabled. Enable at least one Worker before sending requests.";
  const type = empty ? "no_workers_configured" : "no_enabled_workers";
  store.recordGatewayRejection({ method, path, status: 503, type });
  sendJson(res, 503, { error: { message, type } });
  return true;
}

export async function readStreamFully(
  body: ReadableStream<Uint8Array> | null,
  maxBytes = DEFAULT_MAX_UPSTREAM_RESPONSE_BYTES
): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError("maxBytes must be a non-negative safe integer");
  }
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new UpstreamResponseTooLargeError(maxBytes);
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  } finally {
    reader.releaseLock();
  }
}

export async function pipeUpstream(
  res: ServerResponse,
  upstream: Awaited<ReturnType<UpstreamClient["chatCompletions"]>>,
  opts?: { onChunk?: (chunk: Uint8Array) => void }
): Promise<void> {
  const headers: Record<string, string> = {};
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers[key] = value;
  });
  headers["Access-Control-Allow-Origin"] = "*";
  headers["Access-Control-Allow-Headers"] = "*";
  headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS";
  res.writeHead(upstream.status, headers);

  if (!upstream.body) {
    res.end();
    return;
  }

  const reader = upstream.body.getReader();
  let clientClosed = false;
  const onClose = (): void => {
    clientClosed = true;
    reader.cancel().catch(() => undefined);
  };
  // If the downstream client goes away, stop consuming upstream promptly so
  // Clash selector slots and upstream connections are not held for nothing.
  res.once("close", onClose);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        if (clientClosed || res.writableEnded || res.destroyed) break;
        opts?.onChunk?.(value);
        res.write(Buffer.from(value));
      }
    }
    if (!clientClosed && !res.writableEnded && !res.destroyed) res.end();
  } catch (error) {
    if (!res.writableEnded && !res.destroyed) res.destroy(error as Error);
  } finally {
    res.removeListener("close", onClose);
  }
}
