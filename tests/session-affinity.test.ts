/**
 * Session affinity v2: encrypted-reasoning routing hints, disk persistence
 * with TTL, and the stale-reasoning 400 escape. All fixtures are fictitious.
 */
import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AccountRotator,
  DEFAULT_SESSION_AFFINITY_TTL_MS,
  containsStaleReasoningMessage,
  extractEncryptedBlobHashes,
  isStaleReasoningError,
} from "../src/relay/index.js";
import { SessionAffinityStore } from "../src/settings/sessionAffinity.js";
import { UpstreamClient } from "../src/proxy/upstream.js";
import type { GatewaySettings } from "../src/settings/store.js";

const BLOB_A = `fictitious-encrypted-blob worker-2 issued ${"a".repeat(64)}`;
const BLOB_B = `fictitious-encrypted-blob worker-1 issued ${"b".repeat(64)}`;

function blobBody(blob: string): Record<string, unknown> {
  return {
    model: "big-pickle",
    messages: [
      { role: "user", content: "continue" },
      { role: "assistant", content: [{ type: "reasoning", encrypted_content: blob }] },
    ],
  };
}

function baseSettings(over: Partial<GatewaySettings> = {}): GatewaySettings {
  return {
    baseUrl: "https://opencode.ai/zen/v1",
    relayAccessToken: "",
    synthesizeCliHeaders: false,
    cliUserAgent: "opencode-cli/1.0.0",
    cliClient: "cli",
    cliProject: "default",
    routingStrategy: "anonymous_first",
    accounts: [
      { id: "k1", apiKey: "fake-key-one", proxyId: null, proxy: null },
      { id: "k2", apiKey: "fake-key-two", proxyId: null, proxy: null },
    ],
    proxyPool: [],
    proxySubscriptions: [],
    clashBridge: {
      enabled: false,
      apiBase: "http://127.0.0.1:9090",
      apiSecret: "",
      localProxyHost: "127.0.0.1",
      localProxyPort: 7890,
      selectorGroup: "GLOBAL",
    },
    port: 9876,
    ...over,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return new Response(text, {
    status,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(text)),
    },
  });
}

describe("extractEncryptedBlobHashes", () => {
  it("finds nested encrypted_content and signature digests, deduplicated", () => {
    const hashes = extractEncryptedBlobHashes(blobBody(BLOB_A));
    expect(hashes).toHaveLength(1);
    expect(hashes[0]).toMatch(/^[0-9a-f]{64}$/);
    // Same blob twice (chat + responses shapes) still yields one digest.
    const again = extractEncryptedBlobHashes({
      input: [{ type: "reasoning", signature: BLOB_A }],
      messages: [{ role: "assistant", signature: `${BLOB_A}-other-suffix-padding-0123456789` }],
    });
    expect(again.length).toBeGreaterThanOrEqual(1);
  });

  it("ignores short values, unknown keys, and non-objects", () => {
    expect(extractEncryptedBlobHashes(null)).toEqual([]);
    expect(extractEncryptedBlobHashes("encrypted_content")).toEqual([]);
    expect(
      extractEncryptedBlobHashes({ encrypted_content: "tiny", signature: "" })
    ).toEqual([]);
    expect(extractEncryptedBlobHashes({ tool_signature: BLOB_A })).toEqual([]);
  });

  it("stays bounded on hostile inputs", () => {
    let deep: unknown = { encrypted_content: BLOB_A };
    for (let i = 0; i < 100; i++) deep = { nest: deep };
    const hashes = extractEncryptedBlobHashes(deep);
    expect(hashes.length).toBeLessThanOrEqual(1);
    const wide: Record<string, unknown> = {};
    for (let i = 0; i < 50_000; i++) wide[`k${i}`] = { encrypted_content: `${BLOB_A}-${i}` };
    expect(extractEncryptedBlobHashes(wide).length).toBeLessThanOrEqual(64);
  });
});

describe("isStaleReasoningError", () => {
  it("matches caller-bound reasoning rejections on 400 only", () => {
    const msg = "reasoning `encrypted_content` was not issued to this caller";
    expect(isStaleReasoningError(400, JSON.stringify({ error: { message: msg } }))).toBe(true);
    expect(isStaleReasoningError(400, "thinking signature is invalid")).toBe(true);
    expect(isStaleReasoningError(429, msg)).toBe(false);
    expect(isStaleReasoningError(400, "")).toBe(false);
    expect(isStaleReasoningError(400, "bad max_tokens value")).toBe(false);
  });

  it("matches stale messages without a status gate for SSE payloads", () => {
    expect(
      containsStaleReasoningMessage("reasoning `encrypted_content` was not issued to this caller")
    ).toBe(true);
    expect(containsStaleReasoningMessage("")).toBe(false);
    expect(containsStaleReasoningMessage("bad max_tokens value")).toBe(false);
  });
});

describe("rotator affinity snapshots and blob hints", () => {
  function twoWorkers(): AccountRotator {
    const rot = new AccountRotator();
    rot.sync([
      { id: "k1", apiKey: "fake-key-one" },
      { id: "k2", apiKey: "fake-key-two" },
    ]);
    return rot;
  }

  it("restores sessions, drops expired and orphaned bindings", () => {
    const rot = twoWorkers();
    const now = 10_000_000;
    rot.restoreSessions(
      [
        { key: "fresh", accountId: "k2", at: now - 1_000 },
        { key: "expired", accountId: "k2", at: now - DEFAULT_SESSION_AFFINITY_TTL_MS - 1 },
        { key: "orphan", accountId: "deleted", at: now - 1_000 },
      ],
      now
    );
    expect(rot.pickWithHint("unknown-session", [], now).id).toBe("k1");
    // Only the fresh binding survived the restore.
    expect(rot.snapshotSessions().map((entry) => entry.key).sort()).toEqual([
      "fresh",
      "unknown-session",
    ]);
  });

  it("routes unbound blob-carrying sessions to the issuing worker", () => {
    const rot = twoWorkers();
    const hinted = extractEncryptedBlobHashes(blobBody(BLOB_B));
    rot.learnBlobWorkers(hinted, "k1", 5_000);
    // Consume the first round-robin slot: without the hint, the next new
    // session would land on k2, so routing to k1 proves the hint applied.
    expect(rot.pick("other", 5_000).id).toBe("k1");
    const picked = rot.pickWithHint("brand-new", hinted, 5_000);
    expect(picked.id).toBe("k1");
    // The hint binds the session, so follow-up turns stay put (strict).
    expect(rot.pick("brand-new", 5_000).id).toBe("k1");
  });

  it("ignores hints that disagree, expired, or name cooled-down workers", () => {
    const rot = twoWorkers();
    const hashA = extractEncryptedBlobHashes(blobBody(BLOB_A));
    const hashB = extractEncryptedBlobHashes(blobBody(BLOB_B));
    rot.learnBlobWorkers(hashA, "k1", 1_000);
    rot.learnBlobWorkers(hashB, "k2", 1_000);
    // Disagreeing fingerprints: no unanimous worker, fall back to strategy.
    expect(rot.findBlobWorker([...hashA, ...hashB], 1_000)).toBeNull();
    // Expired mapping.
    expect(
      rot.findBlobWorker(hashA, 1_000 + DEFAULT_SESSION_AFFINITY_TTL_MS + 1)
    ).toBeNull();
    // Cooled-down worker is not hinted.
    const k1 = rot.getAccounts().find((account) => account.id === "k1")!;
    rot.markRateLimited(k1, 60_000, 1_000);
    expect(rot.findBlobWorker(hashA, 2_000)).toBeNull();
  });

  it("unbinds sessions without touching other bindings", () => {
    const rot = twoWorkers();
    expect(rot.pick("s-a", 1_000).id).toBe("k1");
    expect(rot.pick("s-b", 1_000).id).toBe("k2");
    rot.unbindSession("s-a");
    expect(rot.snapshotSessions().map((entry) => entry.key)).toEqual(["s-b"]);
  });

  it("forgets blob hints without touching other mappings", () => {
    const rot = twoWorkers();
    const hashA = extractEncryptedBlobHashes(blobBody(BLOB_A));
    const hashB = extractEncryptedBlobHashes(blobBody(BLOB_B));
    rot.learnBlobWorkers(hashA, "k1", 1_000);
    rot.learnBlobWorkers(hashB, "k2", 1_000);
    rot.forgetBlobWorkers(hashA);
    expect(rot.findBlobWorker(hashA, 1_000)).toBeNull();
    expect(rot.findBlobWorker(hashB, 1_000)?.id).toBe("k2");
    expect(() => rot.forgetBlobWorkers([])).not.toThrow();
  });
});

describe("SessionAffinityStore", () => {
  async function tmpStore(): Promise<{ store: SessionAffinityStore; dir: string }> {
    const dir = await mkdtemp(join(tmpdir(), "affinity-"));
    return { store: new SessionAffinityStore(join(dir, "settings.json")), dir };
  }

  it("round-trips routing maps and prunes on load", async () => {
    const { store } = await tmpStore();
    const now = Date.now();
    await store.save({
      sessions: [
        { key: "keep", accountId: "anon-1", at: now - 1_000 },
        { key: "old", accountId: "anon-1", at: now - DEFAULT_SESSION_AFFINITY_TTL_MS - 1 },
      ],
      blobs: [{ key: "a".repeat(64), accountId: "anon-2", at: now - 1_000 }],
    });
    const loaded = await store.load(new Set(["anon-1", "anon-2"]), now);
    expect(loaded.sessions.map((entry) => entry.key)).toEqual(["keep"]);
    expect(loaded.blobs).toHaveLength(1);
    // Unknown workers are dropped even when fresh.
    const reloaded = await store.load(new Set(["anon-1"]), now);
    expect(reloaded.blobs).toEqual([]);
  });

  it("returns empty maps for corrupt files and stores no secrets", async () => {
    const { store, dir } = await tmpStore();
    await store.save({
      sessions: [{ key: "s", accountId: "k1", at: Date.now() }],
      blobs: [],
    });
    const raw = await readFile(join(dir, "session-affinity.json"), "utf8");
    expect(raw).not.toMatch(/apiKey|Bearer|sk-|fake-key/i);
    await writeFile(join(dir, "session-affinity.json"), "{not json");
    expect(await store.load(new Set(["k1"]))).toEqual({ sessions: [], blobs: [] });
  });
});

describe("upstream stale-reasoning escape", () => {
  const staleBody = {
    error: { message: "reasoning `encrypted_content` was not issued to this caller" },
  };

  it("drops the poisoned binding and preserves the upstream 400 verbatim", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400, staleBody));
    const client = new UpstreamClient(baseSettings(), fetchImpl);
    const first = await client.chatCompletions({
      body: blobBody(BLOB_A),
      stream: false,
      clientHeaders: { "x-session-id": "poisoned" },
    });
    expect(first.accountId).toBe("k1");
    // Simulate earlier transport trouble: a normal 400 must NOT clear it.
    const k1 = client.rotator.getAccounts().find((account) => account.id === "k1")!;
    k1.consecutiveFails = 2;
    k1.cooldownUntil = 0;

    const failed = await client.chatCompletions({
      body: blobBody(BLOB_A),
      stream: false,
      clientHeaders: { "x-session-id": "poisoned" },
    });
    expect(failed.status).toBe(400);
    expect(await new Response(failed.body).json()).toEqual(staleBody);
    // Binding dropped so the next turn re-picks instead of pinning the failure.
    expect(client.rotator.snapshotSessions()).toEqual([]);
    // Not a success: failure counters are preserved.
    expect(k1.consecutiveFails).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("keeps strict affinity on ordinary 400s", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400, { error: "bad max_tokens value" }));
    const client = new UpstreamClient(baseSettings(), fetchImpl);
    await client.chatCompletions({
      body: { model: "big-pickle" },
      stream: false,
      clientHeaders: { "x-session-id": "steady" },
    });
    const k1 = client.rotator.getAccounts().find((account) => account.id === "k1")!;
    k1.consecutiveFails = 2;
    await client.chatCompletions({
      body: { model: "big-pickle" },
      stream: false,
      clientHeaders: { "x-session-id": "steady" },
    });
    expect(client.rotator.snapshotSessions().map((entry) => entry.key)).toEqual(["steady"]);
    expect(k1.consecutiveFails).toBe(0);
  });

  it("detects stale 400s without content-length (chunked) and keeps the body intact", async () => {
    const text = JSON.stringify(staleBody);
    const fetchImpl = vi.fn(
      async () =>
        new Response(text, {
          status: 400,
          headers: { "Content-Type": "application/json" },
        })
    );
    const client = new UpstreamClient(baseSettings(), fetchImpl);
    const failed = await client.chatCompletions({
      body: blobBody(BLOB_A),
      stream: false,
      clientHeaders: { "x-session-id": "chunked-poisoned" },
    });
    expect(failed.status).toBe(400);
    expect(await new Response(failed.body).text()).toBe(text);
    expect(client.rotator.snapshotSessions()).toEqual([]);
  });

  it("detects stale 400s wrapped as SSE", async () => {
    const frames = `data: ${JSON.stringify(staleBody)}\n\n`;
    const fetchImpl = vi.fn(
      async () =>
        new Response(frames, {
          status: 400,
          headers: { "Content-Type": "text/event-stream" },
        })
    );
    const client = new UpstreamClient(baseSettings(), fetchImpl);
    const failed = await client.chatCompletions({
      body: blobBody(BLOB_A),
      stream: false,
      clientHeaders: { "x-session-id": "sse-poisoned" },
    });
    expect(failed.status).toBe(400);
    expect(await new Response(failed.body).text()).toBe(frames);
    expect(client.rotator.snapshotSessions()).toEqual([]);
  });

  it("passes over-budget 400 bodies through complete and keeps affinity", async () => {
    const big = `{"error":{"message":"reasoning \`encrypted_content\` was not issued to this caller","pad":"${"p".repeat(40_000)}"}}`;
    const fetchImpl = vi.fn(
      async () => new Response(big, { status: 400, headers: { "Content-Type": "application/json" } })
    );
    const client = new UpstreamClient(baseSettings(), fetchImpl);
    const failed = await client.chatCompletions({
      body: blobBody(BLOB_A),
      stream: false,
      clientHeaders: { "x-session-id": "big-error" },
    });
    expect(failed.status).toBe(400);
    expect(await new Response(failed.body).text()).toBe(big);
    expect(client.rotator.snapshotSessions().map((entry) => entry.key)).toEqual(["big-error"]);
  });

  it("forgets blob hints when a turn goes stale", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { choices: [] }))
      .mockResolvedValueOnce(jsonResponse(400, staleBody));
    const client = new UpstreamClient(baseSettings(), fetchImpl);
    const body = blobBody(BLOB_A);
    const headers = { "x-session-id": "s-forget" };
    const first = await client.chatCompletions({ body, stream: false, clientHeaders: headers });
    expect(first.status).toBe(200);
    const hashes = extractEncryptedBlobHashes(body);
    expect(client.rotator.findBlobWorker(hashes)?.id).toBe(first.accountId);
    const failed = await client.chatCompletions({ body, stream: false, clientHeaders: headers });
    expect(failed.status).toBe(400);
    expect(client.rotator.snapshotSessions()).toEqual([]);
    expect(client.rotator.findBlobWorker(hashes)).toBeNull();
  });

  it("defers blob learning for streams and settles after piping", async () => {
    const frames =
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n' + "data: [DONE]\n\n";
    const fetchImpl = vi.fn(
      async () => new Response(frames, { status: 200, headers: { "Content-Type": "text/event-stream" } })
    );
    const client = new UpstreamClient(baseSettings(), fetchImpl);
    const body = blobBody(BLOB_A);
    const headers = { "x-session-id": "s-stream" };
    const result = await client.chatCompletions({ body, stream: true, clientHeaders: headers });
    expect(result.status).toBe(200);
    const hashes = extractEncryptedBlobHashes(body);
    // HTTP 200 alone proves nothing for streams: learning waits for settle.
    expect(client.rotator.findBlobWorker(hashes)).toBeNull();
    client.settleStreamBlobs({
      body,
      clientHeaders: headers,
      accountId: result.accountId,
      status: 200,
      sseText: frames,
    });
    expect(client.rotator.findBlobWorker(hashes)?.id).toBe(result.accountId);
  });

  it("unbinds and forgets blobs when SSE embeds a stale-reasoning rejection", async () => {
    const frames =
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n' + "data: [DONE]\n\n";
    const fetchImpl = vi.fn(
      async () => new Response(frames, { status: 200, headers: { "Content-Type": "text/event-stream" } })
    );
    const client = new UpstreamClient(baseSettings(), fetchImpl);
    const body = blobBody(BLOB_A);
    const headers = { "x-session-id": "s-sse-stale" };
    const result = await client.chatCompletions({ body, stream: true, clientHeaders: headers });
    client.settleStreamBlobs({
      body,
      clientHeaders: headers,
      accountId: result.accountId,
      status: 200,
      sseText: frames,
    });
    const hashes = extractEncryptedBlobHashes(body);
    expect(client.rotator.findBlobWorker(hashes)?.id).toBe(result.accountId);
    client.settleStreamBlobs({
      body,
      clientHeaders: headers,
      accountId: result.accountId,
      status: 200,
      sseText: `data: ${JSON.stringify(staleBody)}\n\n`,
    });
    expect(client.rotator.snapshotSessions().map((entry) => entry.key)).not.toContain("s-sse-stale");
    expect(client.rotator.findBlobWorker(hashes)).toBeNull();
  });

  it("follows blob hints for keyless turns", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { choices: [] }));
    const client = new UpstreamClient(baseSettings(), fetchImpl);
    const hashes = extractEncryptedBlobHashes(blobBody(BLOB_B));
    client.rotator.learnBlobWorkers(hashes, "k2", Date.now());
    const result = await client.chatCompletions({ body: blobBody(BLOB_B), stream: false });
    expect(result.accountId).toBe("k2");
  });
});
