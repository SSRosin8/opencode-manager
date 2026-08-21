/**
 * opencode-manager - standalone OpenCode free-worker LLM gateway.
 * Entry point: starts HTTP server with OpenAI-compatible passthrough + admin UI.
 */

import { close, createApp, listen } from "./server/http.js";

async function main(): Promise<void> {
  const app = await createApp();
  await listen(app);
  const { host, port } = app;
  console.log(`[opencode-manager] listening on http://${host}:${port}`);
  console.log(`[opencode-manager] admin UI  http://${host}:${port}/`);
  console.log(`[opencode-manager] OpenAI    http://${host}:${port}/v1`);
  console.log(`[opencode-manager] upstream  ${app.store.get().baseUrl}`);

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("[opencode-manager] shutting down…");
    const forceExit = setTimeout(() => process.exit(1), 5000);
    forceExit.unref();
    void close(app).then(
      () => {
        clearTimeout(forceExit);
        process.exit(0);
      },
      (error: unknown) => {
        console.error("[opencode-manager] shutdown failed:", error);
        process.exit(1);
      }
    );
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[opencode-manager] fatal:", err);
  process.exit(1);
});
