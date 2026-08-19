/**
 * OCFreeRelay — standalone OpenCode free-worker LLM gateway.
 * Entry point: starts HTTP server with OpenAI-compatible passthrough + admin UI.
 */

import { createApp, listen } from "./server/http.js";

async function main(): Promise<void> {
  const app = await createApp();
  await listen(app);
  const { port } = app;
  console.log(`[oc-free-relay] listening on http://0.0.0.0:${port}`);
  console.log(`[oc-free-relay] admin UI  http://127.0.0.1:${port}/`);
  console.log(`[oc-free-relay] OpenAI    http://127.0.0.1:${port}/v1`);
  console.log(`[oc-free-relay] upstream  ${app.store.get().baseUrl}`);

  const shutdown = () => {
    console.log("[oc-free-relay] shutting down…");
    app.server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[oc-free-relay] fatal:", err);
  process.exit(1);
});
