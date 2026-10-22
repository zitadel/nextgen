#!/usr/bin/env node
/**
 * The server's custom go/analysis checks plus the Biome lint of its JavaScript
 * launcher: turbo's version of the inline script behind `server:lint` in
 * apps/server/moon.yml. Moon keeps its own until the cutover, so a change to
 * the checks goes into both.
 *
 * The analyzers (today egresslint, ADR 061) run directly rather than through
 * `go vet`, so the built-in vet analyzers keep running alongside (the `vet`
 * task). They run once per build configuration: the default set, then each
 * integration tag on its own, because the tagged files are invisible to the
 * default run and the tags cannot be combined (each lane defines its own
 * TestMain).
 *
 * The launcher (apps/server/bin) is linted here because the server is a Go
 * project and inherits no Biome task; `bin/**` is in the server's inputs, so
 * the task re-runs when the launcher changes.
 */
import { fileURLToPath } from "node:url";

import { isDirectRun, run } from "./dev-process.mjs";
import { serverModuleRoot } from "./server-build.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const moduleRoot = serverModuleRoot(repoRoot);
const INTEGRATION_TAGS = ["postgres_integration", "spanner_integration", "sqlite_integration"];

export async function main() {
  const analyzers = ["run", "./tools/analyzers/cmd/analyzers", "./..."];
  await run("go", analyzers, { cwd: moduleRoot });
  for (const tag of INTEGRATION_TAGS) {
    await run("go", analyzers, { cwd: moduleRoot, env: { ...process.env, GOFLAGS: `-tags=${tag}` } });
  }
  await run(
    "corepack",
    ["pnpm", "exec", "biome", "check", "apps/server/bin", "--no-errors-on-unmatched"],
    { cwd: repoRoot },
  );
}

if (isDirectRun(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(typeof error?.code === "number" ? error.code : 1);
  });
}
