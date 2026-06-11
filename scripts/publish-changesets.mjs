#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const prereleaseMode = existsSync(".changeset/pre.json");
const args = ["pnpm", "changeset", "publish"];
if (prereleaseMode) {
  args.push("--tag", "preview");
}

console.log(
  prereleaseMode
    ? "Publishing changesets to npm with the preview dist-tag."
    : "Publishing changesets to npm with the default dist-tag.",
);

const result = spawnSync("corepack", args, {
  stdio: "inherit",
});

if (result.error) {
  throw new Error(`corepack ${args.join(" ")} failed: ${result.error.message}`);
}

process.exit(result.status ?? 1);
