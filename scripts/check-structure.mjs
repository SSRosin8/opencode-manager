#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(import.meta.dirname, "..");
const SOURCE_DIRS = ["src", "tests", "scripts"];
const CODE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);
const IGNORED_NAMES = new Set(["node_modules", "dist", "coverage"]);
const HARD_LIMIT = 1000;
const TARGET_LIMIT = 600;

async function collectCodeFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (IGNORED_NAMES.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectCodeFiles(path));
    } else if (entry.isFile() && CODE_EXTENSIONS.has(extname(entry.name))) {
      files.push(path);
    }
  }

  return files;
}

function countLines(text) {
  if (text.length === 0) return 0;
  return text.split(/\r?\n/).length - (text.endsWith("\n") ? 1 : 0);
}

const files = (
  await Promise.all(SOURCE_DIRS.map((directory) => collectCodeFiles(resolve(ROOT, directory))))
).flat();
const results = await Promise.all(files.map(async (file) => ({
  file: relative(ROOT, file),
  lines: countLines(await readFile(file, "utf8")),
})));

const violations = results.filter(({ lines }) => lines > HARD_LIMIT);
const warnings = results.filter(({ lines }) => lines > TARGET_LIMIT && lines <= HARD_LIMIT);

for (const { file, lines } of warnings.sort((a, b) => b.lines - a.lines)) {
  console.warn(`[structure] warning: ${file} has ${lines} lines (target: <= ${TARGET_LIMIT})`);
}

for (const { file, lines } of violations.sort((a, b) => b.lines - a.lines)) {
  console.error(`[structure] error: ${file} has ${lines} lines (hard limit: ${HARD_LIMIT})`);
}

if (violations.length > 0) {
  console.error(`[structure] failed: ${violations.length} file(s) exceed the hard limit`);
  process.exitCode = 1;
} else {
  console.log(`[structure] checked ${results.length} code files; no hard-limit violations`);
}
