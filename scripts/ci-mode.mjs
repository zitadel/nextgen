#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const base = process.argv[2] || "origin/main";
const result = spawnSync("git", ["diff", "--name-only", `${base}...HEAD`], {
  encoding: "utf8",
});

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const files = result.stdout.split(/\r?\n/).filter(Boolean);
const mode = files.length > 0 && files.every(isVersionOutputFile) ? "version-only" : "full";

console.log(`mode=${mode}`);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `mode=${mode}\n`);
}

function isVersionOutputFile(file) {
  return file === "pnpm-lock.yaml" ||
    file === ".changeset/pre.json" ||
    file === ".changeset/config.json" ||
    file.startsWith(".changeset/") ||
    file.endsWith("/package.json") ||
    file.endsWith("/CHANGELOG.md");
}
