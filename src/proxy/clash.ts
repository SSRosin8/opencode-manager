/** Fetch and parse Clash-compatible proxy subscriptions into pool entries. */

import {
  parseProxyUri,
  parseSubscriptionBody,
  type ClashHints,
  type ClashParseResult,
} from "./subscriptionParsing.js";

export { parseProxyUri, parseSubscriptionBody };
export type { ClashHints, ClashParseResult };

export const SUBSCRIPTION_USER_AGENTS = [
  "clash",
  "ClashMeta/1.18.0",
  "clash-verge/1.7.7",
  "ClashforWindows/0.20.39",
  "v2rayN/6.45",
  "0dcloud",
  "clash-verge/v2.5.2",
  "opencode-manager/1.0",
] as const;
const MAX_SUBSCRIPTION_BYTES = 8 * 1024 * 1024;

async function readSubscriptionBody(res: Response): Promise<Buffer> {
  const contentLength = Number(res.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_SUBSCRIPTION_BYTES
  ) {
    await res.body
      ?.cancel("subscription response is too large")
      .catch(() => {});
    throw new Error("Subscription response is too large");
  }
  const reader = res.body?.getReader?.();
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_SUBSCRIPTION_BYTES)
      throw new Error("Subscription response is too large");
    return buf;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > MAX_SUBSCRIPTION_BYTES) {
        await reader
          .cancel("subscription response is too large")
          .catch(() => {});
        throw new Error("Subscription response is too large");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

function scoreParsed(result: ClashParseResult): number {
  return result.proxies.length * 10 + (result.format === "clash-yaml" ? 5 : 0);
}

export type FetchSubscriptionOptions = {
  url: string;
  subscriptionId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  userAgent?: string;
  tryMultipleUserAgents?: boolean;
};

async function fetchBody(
  fetchImpl: typeof fetch,
  url: string,
  userAgent: string,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": userAgent,
        Accept: "*/*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    });
    if (!res.ok)
      throw new Error(`Subscription HTTP ${res.status} ${res.statusText}`);
    const body = await readSubscriptionBody(res);
    return { text: body.toString("utf8"), bytes: body.length };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchClashSubscription(
  opts: FetchSubscriptionOptions,
): Promise<ClashParseResult & { rawBytes: number }> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const agents = opts.userAgent
    ? [opts.userAgent]
    : opts.tryMultipleUserAgents === false
      ? [SUBSCRIPTION_USER_AGENTS[0]]
      : [...SUBSCRIPTION_USER_AGENTS];
  let best: (ClashParseResult & { rawBytes: number }) | null = null;
  let lastError: Error | null = null;
  for (const userAgent of agents) {
    try {
      const { text, bytes } = await fetchBody(
        fetchImpl,
        opts.url,
        userAgent,
        timeoutMs,
      );
      const candidate = {
        ...parseSubscriptionBody(text, opts.subscriptionId),
        rawBytes: bytes,
        usedUserAgent: userAgent,
      };
      if (!best || scoreParsed(candidate) > scoreParsed(best)) best = candidate;
      if (
        (candidate.format === "clash-yaml" && candidate.proxies.length >= 3) ||
        candidate.proxies.length >= 10
      )
        break;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  if (best?.proxies.length || best) return best;
  if (lastError) throw lastError;
  throw new Error("Subscription returned no parseable proxies (empty body)");
}
