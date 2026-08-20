/**
 * Build OpenCode zen upstream URLs (OpenAI-compatible surface only for free worker).
 */

export const DEFAULT_BASE_URL = "https://opencode.ai/zen/v1";

export function normalizeBaseUrl(baseUrl: string | undefined | null): string {
  const raw = (baseUrl ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  return raw || DEFAULT_BASE_URL;
}

export function buildChatCompletionsUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/chat/completions`;
}

export function buildModelsUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/models`;
}
