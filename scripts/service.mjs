#!/usr/bin/env node

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(import.meta.dirname, "..");
const RUNTIME_DIR = resolve(
  process.env.OPENCODE_MANAGER_SERVICE_RUNTIME_DIR || resolve(ROOT, "data", "run")
);
const PID_PATH = resolve(RUNTIME_DIR, "service.json");
const LOG_PATH = resolve(RUNTIME_DIR, "service.log");
const ENTRY_PATH = resolve(process.env.OPENCODE_MANAGER_SERVICE_ENTRY || resolve(ROOT, "dist", "index.js"));
const START_TIMEOUT_MS = 10_000;
const STOP_TIMEOUT_MS = 7_000;

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function processMatchesEntry(pid, entryPath) {
  const commandPath = `/proc/${pid}/cmdline`;
  if (!existsSync(commandPath)) return true;
  try {
    const command = readFileSync(commandPath, "utf8").split("\0");
    return command.some((arg) => resolve(arg) === entryPath);
  } catch {
    return true;
  }
}

function readServiceRecord() {
  try {
    const parsed = JSON.parse(readFileSync(PID_PATH, "utf8"));
    if (!Number.isSafeInteger(parsed.pid) || parsed.pid <= 0 || typeof parsed.entryPath !== "string") {
      throw new Error("invalid service record");
    }
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    console.warn(`[service] ignoring invalid runtime record: ${error.message}`);
    rmSync(PID_PATH, { force: true });
    return null;
  }
}

function runningRecord() {
  const record = readServiceRecord();
  if (!record) return null;
  if (processExists(record.pid) && processMatchesEntry(record.pid, resolve(record.entryPath))) {
    return record;
  }
  rmSync(PID_PATH, { force: true });
  return null;
}

function settingsPort() {
  const envPort = Number(process.env.PORT);
  if (Number.isInteger(envPort) && envPort > 0 && envPort <= 65535) return envPort;
  const settingsPath = resolve(
    process.env.OPENCODE_MANAGER_SETTINGS_PATH || resolve(ROOT, "data", "settings.json")
  );
  try {
    const port = Number(JSON.parse(readFileSync(settingsPath, "utf8")).port);
    if (Number.isInteger(port) && port > 0 && port <= 65535) return port;
  } catch {
    // A missing or unreadable settings file means the application default applies.
  }
  return 9876;
}

function healthUrl() {
  const configured = process.env.OPENCODE_MANAGER_HOST?.trim() || "127.0.0.1";
  const host = configured === "0.0.0.0"
    ? "127.0.0.1"
    : configured === "::"
      ? "[::1]"
      : configured.includes(":") && !configured.startsWith("[")
        ? `[${configured}]`
        : configured;
  return `http://${host}:${settingsPort()}/health`;
}

async function waitForStart(pid) {
  const url = healthUrl();
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!processExists(pid)) throw new Error(`service exited during startup; inspect ${LOG_PATH}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(700) });
      if (response.ok) return url;
    } catch {
      // The listener may not be ready yet.
    }
    await sleep(150);
  }
  throw new Error(`health check timed out at ${url}; inspect ${LOG_PATH}`);
}

async function startService() {
  const current = runningRecord();
  if (current) {
    console.log(`[service] already running (PID ${current.pid})`);
    return;
  }
  if (!existsSync(ENTRY_PATH)) {
    throw new Error(`built entry not found: ${ENTRY_PATH}; run npm run build first`);
  }
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const logFd = openSync(LOG_PATH, "a");
  let child;
  try {
    child = spawn(process.execPath, [ENTRY_PATH], {
      cwd: ROOT,
      detached: true,
      env: process.env,
      stdio: ["ignore", logFd, logFd],
    });
  } finally {
    closeSync(logFd);
  }
  child.unref();
  const record = {
    pid: child.pid,
    entryPath: ENTRY_PATH,
    startedAt: new Date().toISOString(),
    healthUrl: healthUrl(),
  };
  writeFileSync(PID_PATH, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  try {
    const url = await waitForStart(child.pid);
    console.log(`[service] started (PID ${child.pid})`);
    console.log(`[service] admin: ${url.replace(/\/health$/, "/")}`);
    console.log(`[service] log: ${LOG_PATH}`);
  } catch (error) {
    rmSync(PID_PATH, { force: true });
    if (processExists(child.pid)) process.kill(child.pid, "SIGTERM");
    throw error;
  }
}

async function stopService() {
  const record = runningRecord();
  if (!record) {
    console.log("[service] already stopped");
    return;
  }
  process.kill(record.pid, "SIGTERM");
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!processExists(record.pid)) {
      rmSync(PID_PATH, { force: true });
      console.log(`[service] stopped (PID ${record.pid})`);
      return;
    }
    await sleep(100);
  }
  throw new Error(`service PID ${record.pid} did not stop after SIGTERM`);
}

function showStatus() {
  const record = runningRecord();
  if (!record) {
    console.log("[service] stopped");
    return;
  }
  console.log(`[service] running (PID ${record.pid}, since ${record.startedAt})`);
  const url = typeof record.healthUrl === "string" ? record.healthUrl : healthUrl();
  console.log(`[service] admin: ${url.replace(/\/health$/, "/")}`);
  console.log(`[service] log: ${LOG_PATH}`);
}

async function main() {
  const command = process.argv[2];
  if (command === "start") await startService();
  else if (command === "stop") await stopService();
  else if (command === "restart") {
    await stopService();
    await startService();
  } else if (command === "status") showStatus();
  else throw new Error("usage: node scripts/service.mjs <start|stop|restart|status>");
}

main().catch((error) => {
  console.error(`[service] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
