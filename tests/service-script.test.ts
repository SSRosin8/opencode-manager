import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const SERVICE_SCRIPT = resolve(ROOT, "scripts", "service.mjs");
const cleanup: Array<() => Promise<void>> = [];

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

function run(command: string, env: NodeJS.ProcessEnv): string {
  return execFileSync(process.execPath, [SERVICE_SCRIPT, command], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 15_000,
  });
}

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
});

describe("service script", () => {
  it("exposes short package commands and a distinct foreground command", async () => {
    const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts).toMatchObject({
      start: "npm run build && node scripts/service.mjs start",
      stop: "node scripts/service.mjs stop",
      restart: "npm run build && node scripts/service.mjs restart",
      status: "node scripts/service.mjs status",
      foreground: "node dist/index.js",
    });
    expect(Object.keys(pkg.scripts).some((name) => name.startsWith("service:"))).toBe(false);
  });

  it("starts, reports, avoids duplicate starts, and gracefully stops", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opencode-manager-service-"));
    const entry = join(dir, "fixture-service.mjs");
    const port = await unusedPort();
    const env = {
      OPENCODE_MANAGER_SERVICE_RUNTIME_DIR: join(dir, "run"),
      OPENCODE_MANAGER_SERVICE_ENTRY: entry,
      PORT: String(port),
    };
    await writeFile(entry, [
      'import { createServer } from "node:http";',
      `const server = createServer((req, res) => {`,
      `  if (req.url === "/health") { res.writeHead(200); res.end("ok"); return; }`,
      `  res.writeHead(404); res.end();`,
      `});`,
      `server.listen(Number(process.env.PORT), "127.0.0.1");`,
      `process.on("SIGTERM", () => server.close(() => process.exit(0)));`,
    ].join("\n"));
    cleanup.push(async () => {
      try { run("stop", env); } catch { /* already stopped or failed startup */ }
      await rm(dir, { recursive: true, force: true });
    });

    expect(run("status", env)).toContain("[service] stopped");
    const started = run("start", env);
    expect(started).toContain("[service] started (PID ");
    expect(started).toContain(`admin: http://127.0.0.1:${port}/`);
    expect(run("status", env)).toContain("[service] running (PID ");
    expect(run("start", env)).toContain("[service] already running");
    expect(run("stop", env)).toContain("[service] stopped (PID ");
    expect(run("stop", env)).toContain("[service] already stopped");
    await expect(readFile(join(dir, "run", "service.log"), "utf8")).resolves.toBe("");
  }, 30_000);

  it("discards an invalid runtime record", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opencode-manager-service-stale-"));
    const runtime = join(dir, "run");
    const env = { OPENCODE_MANAGER_SERVICE_RUNTIME_DIR: runtime };
    await writeFile(join(dir, "placeholder"), "");
    await mkdir(runtime);
    await writeFile(join(runtime, "service.json"), "not-json");
    cleanup.push(() => rm(dir, { recursive: true, force: true }));

    expect(run("status", env)).toContain("[service] stopped");
  });
});
