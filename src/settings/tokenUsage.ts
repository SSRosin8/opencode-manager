/** Normalized token usage reported by OpenAI-compatible upstreams. */
export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Tokens read from prompt cache (hit). */
  cacheReadTokens: number;
  /** Tokens explicitly written/created in the provider cache. */
  cacheWriteTokens: number;
  /** Input tokens not served from cache (not necessarily written). */
  cacheMissTokens: number;
};

export type ModelTokenUsage = TokenUsage & { requestCount: number };

/** Non-negative integer (0 allowed). */
function tokenCount(value: unknown): number {
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.floor(count);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseCacheTokens(usage: Record<string, unknown>): {
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheMissTokens: number;
} {
  const promptDetails = asRecord(usage.prompt_tokens_details) ?? {};
  const inputDetails = asRecord(usage.input_tokens_details) ?? {};

  const cacheReadTokens = Math.max(
    tokenCount(usage.prompt_cache_hit_tokens),
    tokenCount(usage.cache_read_input_tokens),
    tokenCount(usage.cache_read_tokens),
    tokenCount(promptDetails.cached_tokens),
    tokenCount(inputDetails.cached_tokens)
  );
  const cacheWriteTokens = Math.max(
    tokenCount(usage.cache_write_tokens),
    tokenCount(usage.prompt_cache_write_tokens),
    tokenCount(usage.cache_creation_input_tokens),
    tokenCount(usage.cache_creation_tokens),
    tokenCount(promptDetails.cache_write_tokens),
    tokenCount(promptDetails.cache_creation_tokens),
    tokenCount(inputDetails.cache_write_tokens)
  );

  return {
    cacheReadTokens,
    cacheWriteTokens,
    cacheMissTokens: tokenCount(usage.prompt_cache_miss_tokens),
  };
}

/** Extract OpenAI/OpenCode-style usage from a JSON completion or response object. */
export function parseUsageFromObject(obj: unknown): TokenUsage | null {
  const root = asRecord(obj);
  if (!root) return null;
  const response = asRecord(root.response);
  const usage = asRecord(root.usage ?? response?.usage);
  if (!usage) return null;

  const promptTokens = tokenCount(usage.prompt_tokens ?? usage.input_tokens);
  const completionTokens = tokenCount(usage.completion_tokens ?? usage.output_tokens);
  let totalTokens = tokenCount(usage.total_tokens);
  if (!totalTokens && (promptTokens || completionTokens)) {
    totalTokens = promptTokens + completionTokens;
  }
  const { cacheReadTokens, cacheWriteTokens, cacheMissTokens } = parseCacheTokens(usage);

  if (
    !promptTokens &&
    !completionTokens &&
    !totalTokens &&
    !cacheReadTokens &&
    !cacheWriteTokens &&
    !cacheMissTokens
  ) {
    return null;
  }
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cacheReadTokens,
    cacheWriteTokens,
    cacheMissTokens,
  };
}

/** Scan SSE data lines for the last complete event containing usage. */
export function parseUsageFromSseBuffer(buffer: string): TokenUsage | null {
  let found: TokenUsage | null = null;
  for (const line of buffer.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const usage = parseUsageFromObject(JSON.parse(data) as unknown);
      if (usage) found = usage;
    } catch {
      // Streaming buffers may end with an incomplete SSE frame.
    }
  }
  return found;
}
