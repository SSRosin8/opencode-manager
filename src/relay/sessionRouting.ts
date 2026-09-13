/**
 * Session routing signals for worker affinity.
 *
 * A stable per-conversation key keeps multi-turn reasoning (thinking
 * signatures / encrypted_content, which upstream callers bind to the issuing
 * worker identity) on the worker that issued it. Chat Completions is
 * stateless, so the key can only come from client headers or, for the
 * Responses protocol, the standard previous_response_id pointer.
 */

import { createHash } from "node:crypto";

/** Hard cap so crafted headers cannot grow routing keys without bound. */
const MAX_SESSION_KEY_LENGTH = 200;

const SESSION_HEADER_NAMES = new Set([
  "x-session-id",
  "x-opencode-session",
  "x-session-affinity",
]);

function cleanSessionKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/[\r\n\t]+/g, " ");
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_SESSION_KEY_LENGTH);
}

/** Prefer explicit OpenCode conversation headers (case-insensitive). */
export function sessionKeyFromHeaders(
  headers?: Record<string, string> | null
): string | undefined {
  if (!headers) return undefined;
  for (const [name, value] of Object.entries(headers)) {
    if (SESSION_HEADER_NAMES.has(name.toLowerCase())) {
      const key = cleanSessionKey(value);
      if (key) return key;
    }
  }
  return undefined;
}

/**
 * Responses-protocol fallback: previous_response_id is the standard
 * server-side conversation pointer. Chat Completions has no equivalent
 * field, so only Responses bodies contribute a key.
 */
export function sessionKeyFromRequestBody(
  body: unknown,
  protocol?: "chat" | "responses"
): string | undefined {
  if (protocol !== "responses") return undefined;
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  return cleanSessionKey((body as Record<string, unknown>).previous_response_id);
}

/**
 * Resolve the routing key for one relay request. Explicit callers win,
 * then client headers, then the Responses body pointer.
 */
export function resolveSessionKey(opts: {
  sessionKey?: string;
  clientHeaders?: Record<string, string> | null;
  body?: unknown;
  protocol?: "chat" | "responses";
}): string | undefined {
  return (
    cleanSessionKey(opts.sessionKey) ??
    sessionKeyFromHeaders(opts.clientHeaders) ??
    sessionKeyFromRequestBody(opts.body, opts.protocol)
  );
}

/** Request keys that carry caller-bound encrypted reasoning payloads. */
const ENCRYPTED_BLOB_KEYS = new Set(["encrypted_content", "signature"]);

/** Bounds so hostile multimodal bodies cannot exhaust the router. */
const MAX_BLOB_VALUES = 64;
const MAX_BLOB_VALUE_LENGTH = 16_384;
const MIN_BLOB_VALUE_LENGTH = 16;
const MAX_TRAVERSED_NODES = 20_000;
const MAX_TRAVERSE_DEPTH = 16;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Collect sha256 fingerprints of encrypted-reasoning payloads in a request
 * body. Only digests leave this function — never message content — so the
 * result is safe to keep in routing maps and on disk.
 */
export function extractEncryptedBlobHashes(body: unknown): string[] {
  const hashes = new Set<string>();
  if (!body || typeof body !== "object") return [];
  const stack: Array<{ value: unknown; depth: number }> = [{ value: body, depth: 0 }];
  let visited = 0;
  while (stack.length > 0 && hashes.size < MAX_BLOB_VALUES && visited < MAX_TRAVERSED_NODES) {
    const frame = stack.pop()!;
    visited += 1;
    const { value, depth } = frame;
    if (Array.isArray(value)) {
      if (depth < MAX_TRAVERSE_DEPTH) {
        for (const item of value) stack.push({ value: item, depth: depth + 1 });
      }
      continue;
    }
    if (!value || typeof value !== "object" || depth >= MAX_TRAVERSE_DEPTH) continue;
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === "string" && ENCRYPTED_BLOB_KEYS.has(key)) {
        if (entry.length >= MIN_BLOB_VALUE_LENGTH && entry.length <= MAX_BLOB_VALUE_LENGTH) {
          hashes.add(sha256Hex(entry));
        }
      } else if (entry && typeof entry === "object") {
        stack.push({ value: entry, depth: depth + 1 });
      }
    }
    if (hashes.size >= MAX_BLOB_VALUES) break;
  }
  return [...hashes];
}

const STALE_REASONING_PATTERNS = [
  /not issued to this caller/i,
  /invalid.{0,24}signature/i,
  /signature.{0,24}(invalid|required|missing)/i,
  /reasoning.{0,40}signature/i,
];

/**
 * Recognize upstream 400s caused by replaying encrypted reasoning that was
 * issued to a different caller. Only the status + message shape is matched;
 * the body itself is passed through untouched.
 */
export function isStaleReasoningError(status: number, bodyText: string): boolean {
  if (status !== 400 || !bodyText) return false;
  return STALE_REASONING_PATTERNS.some((pattern) => pattern.test(bodyText));
}
