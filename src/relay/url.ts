/**
 * Build OpenCode zen upstream URLs (OpenAI-compatible surface only for free worker).
 */

export const DEFAULT_BASE_URL = "https://opencode.ai/zen/v1";

export function normalizeBaseUrl(baseUrl: string | undefined | null): string {
  const raw = (baseUrl ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  if (!raw) return DEFAULT_BASE_URL;
  // Only http(s) upstreams; anything else (file:, gopher:, bare host) would
  // either throw in undici or turn the Bearer key into an SSRF primitive.
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return DEFAULT_BASE_URL;
    if (!parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
      return DEFAULT_BASE_URL;
    }
    return raw;
  } catch {
    return DEFAULT_BASE_URL;
  }
}

export function buildChatCompletionsUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/chat/completions`;
}

export function buildResponsesUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/responses`;
}

export function buildModelsUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/models`;
}
