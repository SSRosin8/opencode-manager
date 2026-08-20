/**
 * opencode-manager - standalone OpenCode free-worker LLM gateway.
 * Entry point: starts HTTP server with OpenAI-compatible passthrough + admin UI.
 */

import { createApp, listen } from "./server/http.js";

async function main(): Promise<void> {
  const app = await createApp();
  await listen(app);
  const { host, port } = app;
  console.log(`[opencode-manager] listening on http://${host}:${port}`);
  console.log(`[opencode-manager] admin UI  http://${host}:${port}/`);
  console.log(`[opencode-manager] OpenAI    http://${host}:${port}/v1`);
  console.log(`[opencode-manager] upstream  ${app.store.get().baseUrl}`);

  const shutdown = () => {
    console.log("[opencode-manager] shutting down…");
    app.server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[opencode-manager] fatal:", err);
  process.exit(1);
});
