/**
 * Minimal OpenCode free-model request body fixes (passthrough + strip/inject).
 * Adapted from OmniRoute open-sse/executors/opencode.ts transformRequest
 * and open-sse/utils/reasoningContentInjector.ts
 */

const PLACEHOLDER = " ";

const THINKING_MODEL_PATTERNS: RegExp[] = [
  /deepseek/i,
  /\bkimi\b/i,
  /\bk2\b/i,
  /\bminimax\b/i,
  /\bmimo\b/i,
];

const EFFORT_LEVELS = ["low", "medium", "high", "max"] as const;

/** Effort-tier models on opencode-go / free family (subset used for free path). */
const EFFORT_TIERS: Record<string, readonly string[]> = {
  "deepseek-v4-pro": EFFORT_LEVELS,
  "deepseek-v4-flash": ["high", "max"],
  "glm-5.2": ["high", "max"],
  "mimo-v2.5": ["high", "max"],
  "grok-4.5": ["low", "medium", "high"],
  hy3: ["none", "low", "high"],
  "kimi-k3": ["max"],
  "qwen3.6-plus": ["high", "max"],
  "qwen3.7-max": ["high", "max"],
  "qwen3.7-plus": ["high", "max"],
};

export function isThinkingMessageModel(model: string | undefined | null): boolean {
  if (!model || typeof model !== "string") return false;
  return THINKING_MODEL_PATTERNS.some((re) => re.test(model));
}

export function parseEffortLevel(
  model: string
): { baseModel: string; effort: string } | null {
  const m = String(model || "");
  for (const [baseModel, levels] of Object.entries(EFFORT_TIERS)) {
    for (const level of levels) {
      if (m === `${baseModel}-${level}`) {
        return { baseModel, effort: level };
      }
    }
  }
  return null;
}

function hasNonEmptyReasoningContent(message: Record<string, unknown>): boolean {
  return (
    typeof message.reasoning_content === "string" &&
    (message.reasoning_content as string).trim().length > 0
  );
}

function isAssistantMessage(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).role === "assistant"
  );
}

/**
 * Inject placeholder reasoning_content on assistant messages for thinking models.
 */
export function injectReasoningContentForThinkingModel(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.messages)) return body;

  let modified = false;
  const messages = record.messages.map((message) => {
    if (!isAssistantMessage(message)) return message;
    if (hasNonEmptyReasoningContent(message)) return message;
    modified = true;
    return { ...message, reasoning_content: PLACEHOLDER };
  });

  return modified ? { ...record, messages } : body;
}

/**
 * Transform chat completion body for OpenCode free upstream while preserving
 * all other fields (true passthrough + minimal fixes).
 */
export function transformRequestBody(model: string, body: unknown, stream: boolean): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return body;
  }

  // Shallow clone so we never mutate the caller's object.
  let modifiedBody: Record<string, unknown> = {
    ...(body as Record<string, unknown>),
    model,
    stream,
  };

  // Strip fields OpenCode upstream rejects (client_metadata).
  if (Object.prototype.hasOwnProperty.call(modifiedBody, "client_metadata")) {
    delete modifiedBody.client_metadata;
  }

  // Cap tools array (upstream limits).
  if (Array.isArray(modifiedBody.tools) && modifiedBody.tools.length > 128) {
    modifiedBody.tools = modifiedBody.tools.slice(0, 128);
  }

  // Effort-tier model aliases → base model + reasoning_effort.
  const parsed = parseEffortLevel(model);
  if (parsed) {
    modifiedBody.model = parsed.baseModel;
    if (modifiedBody.reasoning_effort === undefined) {
      modifiedBody.reasoning_effort = parsed.effort;
    }
  }

  // Thinking models need reasoning_content replayed on assistant turns.
  if (isThinkingMessageModel(String(modifiedBody.model ?? model))) {
    modifiedBody = injectReasoningContentForThinkingModel(modifiedBody) as Record<
      string,
      unknown
    >;
  }

  return modifiedBody;
}

/**
 * Pure passthrough: return a JSON-serializable copy of body with stream/model
 * normalized, without OpenCode-specific strips. Used in tests to contrast with
 * transformRequestBody when needed; production path uses transformRequestBody.
 */
export function passthroughBody(model: string, body: unknown, stream: boolean): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  return {
    ...(body as Record<string, unknown>),
    model,
    stream,
  };
}
