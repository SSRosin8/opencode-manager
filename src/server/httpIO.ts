import type { IncomingMessage, ServerResponse } from "node:http";
import type { UpstreamClient } from "../proxy/upstream.js";
import type { SettingsStore } from "../settings/store.js";

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

export class RequestBodyTooLargeError extends Error {
  readonly status = 413;

  constructor(readonly limit: number) {
    super(`Request body exceeds ${limit} bytes`);
    this.name = "RequestBodyTooLargeError";
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

export function readBody(
  req: IncomingMessage,
  maxBytes = DEFAULT_MAX_BODY_BYTES
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    req.on("data", (chunk) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) {
        settled = true;
        reject(new RequestBodyTooLargeError(maxBytes));
        return;
      }
      chunks.push(buffer);
    });
    req.on("end", () => {
      if (!settled) resolve(Buffer.concat(chunks));
    });
    req.on("error", (error) => {
      if (!settled) reject(error);
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

export function rejectUnavailableWorkerPool(
  res: ServerResponse,
  store: SettingsStore,
  path: string
): boolean {
  const accounts = store.get().accounts;
  if (accounts.some((account) => account.enabled !== false)) return false;

  const empty = accounts.length === 0;
  const message = empty
    ? "No Zen workers are configured. Add a Worker or run a batch proxy test to create anonymous Workers."
    : "All configured Zen workers are disabled. Enable at least one Worker before sending requests.";
  const type = empty ? "no_workers_configured" : "no_enabled_workers";
  store.recordRequest(path, 503, message);
  sendJson(res, 503, { error: { message, type } });
  return true;
}

export async function readStreamFully(
  body: ReadableStream<Uint8Array> | null
): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
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
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        opts?.onChunk?.(value);
        res.write(Buffer.from(value));
      }
    }
    res.end();
  } catch (error) {
    res.destroy(error as Error);
  }
}
