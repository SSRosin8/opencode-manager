/**
 * Free-model registry for opencode-manager.
 *
 * Determines which upstream models are "free" from the official OpenCode Zen
 * model catalog. Zen identifies its public free models with a `-free` suffix,
 * apart from a small explicit allowlist of official special ids. The HTTP
 * layer serves ONLY these models so no paid model is exposed to clients.
 *
 * Resilience:
 *  - The parsed result is cached to data/free-models.json (last success).
 *  - On refresh failure we keep the previous set (disk / memory), and before
 *    any successful refresh we use a static baseline of the currently-known
 *    free model ids so a fresh boot is not empty and no paid model leaks.
 */

import { mkdir, open, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const ZEN_MODELS_URL =
  process.env.OPENCODE_MANAGER_MODELS_URL || "https://opencode.ai/zen/v1/models";

const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const MAX_CACHE_BYTES = 256 * 1024;
const MAX_CACHED_MODEL_IDS = 1_000;
const SPECIAL_FREE_MODEL_IDS = new Set(["big-pickle"]);

function normalizeFreeModelIds(values: unknown[]): string[] {
  const found = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const id = normalizeModelName(value);
    if (!id || (!id.endsWith("-free") && !SPECIAL_FREE_MODEL_IDS.has(id))) continue;
    found.add(id);
    if (found.size >= MAX_CACHED_MODEL_IDS) break;
  }
  return [...found];
}

async function readCacheText(path: string): Promise<string> {
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(MAX_CACHE_BYTES + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_CACHE_BYTES) throw new Error("model cache is too large");
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await file.close();
  }
}

async function readCatalogText(res: Response): Promise<string> {
  const reader = res.body?.getReader?.();
  if (!reader) {
    const text = await res.text();
    if (Buffer.byteLength(text, "utf8") > MAX_CATALOG_BYTES) {
      throw new Error("model catalog response is too large");
    }
    return text;
  }

  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > MAX_CATALOG_BYTES) {
        await reader.cancel("model catalog response is too large").catch(() => {});
        throw new Error("model catalog response is too large");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size).toString("utf8");
}

/**
 * Baseline free-model ids (snapshot of the official Zen model catalog).
 * Used as the starting set / last-resort fallback; refreshed from the catalog.
 */
export const KNOWN_FREE_MODELS: string[] = [
  "big-pickle",
  "deepseek-v4-flash-free",
  "mimo-v2.5-free",
  "laguna-s-2.1-free",
  "ling-3.0-flash-free",
  "longcat-2.0-free",
  "north-mini-code-free",
  "nemotron-3-ultra-free",
];

/** "DeepSeek V4 Flash Free" -> "deepseek-v4-flash-free" (lowercase, dash-separated). */
export function normalizeModelName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Extract free ids from the official Zen `/models` response. Using the live
 * catalog prevents stale documentation from hiding newly available models;
 * the strict naming rule prevents paid or malformed entries from leaking.
 */
export function parseFreeModelIds(payload: unknown): string[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const ids: unknown[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    ids.push((entry as { id?: unknown }).id);
  }
  return normalizeFreeModelIds(ids);
}

export type FreeModelStatus = {
  count: number;
  ids: string[];
  lastFetchedAt: string | null;
  lastError: string | null;
  usingBaseline: boolean;
};

function defaultCachePath(): string {
  const settingsPath = process.env.OPENCODE_MANAGER_SETTINGS_PATH;
  const base = settingsPath ? dirname(settingsPath) : resolve(process.cwd(), "data");
  return resolve(base, "free-models.json");
}

export class FreeModelRegistry {
  private _ids = new Set<string>();
  private lastFetchedAt: string | null = null;
  private lastError: string | null = null;
  private cachePath: string;

  constructor(opts?: { defaultIds?: string[]; cachePath?: string }) {
    this._ids = new Set(opts?.defaultIds ?? KNOWN_FREE_MODELS);
    this.cachePath = opts?.cachePath ?? defaultCachePath();
  }

  /** True when the model (bare id, e.g. "big-pickle") is in the free set. */
  has(id: string | undefined | null): boolean {
    if (!id) return false;
    if (this._ids.has(id)) return true;
    const norm = normalizeModelName(id);
    return this._ids.has(norm);
  }

  ids(): string[] {
    return [...this._ids].sort();
  }

  count(): number {
    return this._ids.size;
  }

  status(): FreeModelStatus {
    return {
      count: this._ids.size,
      ids: this.ids(),
      lastFetchedAt: this.lastFetchedAt,
      lastError: this.lastError,
      usingBaseline: this.lastFetchedAt === null,
    };
  }

  /** Restore the last successful catalog refresh from disk. */
  async loadCache(): Promise<void> {
    try {
      const text = await readCacheText(this.cachePath);
      const parsed = JSON.parse(text) as { fetchedAt?: string; ids?: unknown };
      const ids = Array.isArray(parsed.ids)
        ? normalizeFreeModelIds(parsed.ids)
        : [];
      if (ids.length) {
        this._ids = new Set(ids);
        this.lastFetchedAt = typeof parsed.fetchedAt === "string" ? parsed.fetchedAt : null;
        this.lastError = null;
      }
    } catch {
      /* no cache yet — keep baseline */
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.cachePath), { recursive: true });
    await writeFile(
      this.cachePath,
      JSON.stringify(
        { fetchedAt: this.lastFetchedAt, ids: this.ids() },
        null,
        2
      ),
      "utf8"
    );
  }

  /**
   * Fetch the official model catalog and update the free set. On failure the previous
   * set is kept (disk / memory / baseline) and the error is recorded.
   */
  async refresh(fetchImpl?: typeof fetch): Promise<FreeModelStatus> {
    const fetcher = fetchImpl ?? globalThis.fetch;
    try {
      const res = await fetcher(ZEN_MODELS_URL, {
        headers: { "User-Agent": "opencode-manager/1.0 (+https://github.com)" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`model catalog HTTP ${res.status}`);
      const contentLength = Number(res.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > MAX_CATALOG_BYTES) {
        throw new Error("model catalog response is too large");
      }
      const text = await readCatalogText(res);
      const payload: unknown = JSON.parse(text);
      const parsed = parseFreeModelIds(payload);
      if (parsed.length === 0) {
        throw new Error("model catalog contained 0 free models");
      }
      this._ids = new Set(parsed);
      this.lastFetchedAt = new Date().toISOString();
      this.lastError = null;
      await this.persist();
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      // keep previous set
    }
    return this.status();
  }
}
