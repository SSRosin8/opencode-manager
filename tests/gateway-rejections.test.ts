import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FreeModelRegistry } from "../src/proxy/freeModels.js";
import { close, createApp, listen, type App } from "../src/server/http.js";
import { SettingsStore, type GatewayRejectionEvent } from "../src/settings/store.js";

let app: App | null = null;

afterEach(async () => {
  if (app) {
    await close(app);
    app = null;
  }
});

describe("gateway rejection events", () => {
  it("reports pre-upstream failures without retaining query parameters or request bodies", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opencode-manager-rejections-"));
    const store = new SettingsStore(join(dir, "settings.json"));
    await store.save({
      accounts: [{ id: "worker-1", apiKey: "test-key", proxyId: null, proxy: null }],
    });
    let upstreamCalls = 0;
    app = await createApp({
      store,
      port: 0,
      fetchImpl: async () => {
        upstreamCalls += 1;
        return new Response("{}", { status: 200 });
      },
      freeModels: new FreeModelRegistry({ cachePath: join(dir, "free-models.json") }),
    });
    await listen(app);
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("no address");
    const base = `http://127.0.0.1:${address.port}`;

    try {
      const notFound = await fetch(`${base}/v1/responses?subscription=do-not-store`);
      expect(notFound.status).toBe(404);

      const invalidJson = await fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "private invalid body",
      });
      expect(invalidJson.status).toBe(400);

      const disallowed = await fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "paid-test-model?private-model-param", messages: [] }),
      });
      expect(disallowed.status).toBe(403);

      await store.save({ accounts: [] });
      app.upstream.updateSettings(store.get());
      const noWorkers = await fetch(`${base}/v1/models`);
      expect(noWorkers.status).toBe(503);

      await store.save({ relayAccessToken: "relay-secret-do-not-store" });
      const unauthorized = await fetch(`${base}/v1/models`, {
        headers: { "X-OC-Relay-Key": "wrong-secret-do-not-store" },
      });
      expect(unauthorized.status).toBe(401);

      const statusResponse = await fetch(`${base}/admin/api/status`);
      const status = (await statusResponse.json()) as {
        recentGatewayRejections: GatewayRejectionEvent[];
      };
      expect(status.recentGatewayRejections).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: "GET",
            path: "/v1/responses",
            status: 404,
            type: "not_found",
            stage: "gateway",
          }),
          expect.objectContaining({
            method: "POST",
            status: 400,
            type: "invalid_request_error",
          }),
          expect.objectContaining({
            status: 403,
            type: "model_not_allowed",
            model: "paid-test-model",
          }),
          expect.objectContaining({
            method: "GET",
            status: 503,
            type: "no_workers_configured",
          }),
          expect.objectContaining({
            method: "GET",
            status: 401,
            type: "authentication_error",
          }),
        ])
      );
      expect(status.recentGatewayRejections.every((event) => event.requestId.length > 8)).toBe(true);
      expect(JSON.stringify(status)).not.toContain("do-not-store");
      expect(JSON.stringify(status)).not.toContain("private invalid body");
      expect(JSON.stringify(status)).not.toContain("private-model-param");
      expect(JSON.stringify(status)).not.toContain("wrong-secret-do-not-store");
      expect(JSON.stringify(status)).not.toContain("relay-secret-do-not-store");
      expect(upstreamCalls).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
