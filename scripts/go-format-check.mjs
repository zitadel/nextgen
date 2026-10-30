#!/usr/bin/env node
/**
 * Fails when gofmt would rewrite a tracked Go file.
 *
 * Checks the Go files git tracks below the current directory, so it serves
 * both Go modules: run from the repository root for the server, from
 * tools/bench for the benchmark harness. Turbo's version of the inline script
 * the `format` tasks in apps/server/moon.yml and tools/bench/moon.yml run;
 * moon keeps its own until the cutover, so a change to the check goes into
 * both.
 */
import { execFileSync } from "node:child_process";

import { isDirectRun } from "./dev-process.mjs";

// Keeps each gofmt invocation well inside the argument length limit.
const CHUNK = 500;

export function unformattedFiles({ cwd = process.cwd(), exec = execFileSync } = {}) {
  const listed = exec(
    "git",
    ["ls-files", "-z", "--", "*.go", ":!tools/bench/**", ":!tools/oidc-mock/**"],
    { cwd, encoding: "utf8" },
  );
  const files = listed.split("\0").filter(Boolean);
  const unformatted = [];
  for (let i = 0; i < files.length; i += CHUNK) {
    const output = exec("gofmt", ["-l", ...files.slice(i, i + CHUNK)], { cwd, encoding: "utf8" });
    unformatted.push(...output.split("\n").filter(Boolean));
  }
  return unformatted;
}

export function main() {
  const unformatted = unformattedFiles();
  if (unformatted.length === 0) {
    return 0;
  }
  console.error("error: gofmt would rewrite the following files:");
  for (const file of unformatted) console.error(file);
  console.error("hint: run gofmt -w on those paths, then re-run this check");
  return 1;
}

if (isDirectRun(import.meta.url)) {
  process.exit(main());
}
