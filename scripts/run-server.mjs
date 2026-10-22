#!/usr/bin/env node
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { forwardedArgs, run } from "./dev-process.mjs";
import { serverModuleRoot } from "./server-build.mjs";
import { runnerCommand } from "./task-runner.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const args = withServerMigrateArgs(forwardedArgs());
// The module compiles in apps/api, but the server runs from the repository
// root, as before the module moved: its default config search (`.`,
// `./config`) and a relative --config path resolve against the checkout.
// `go run` (and `go -C`) would run it inside the module, so build to dist
// and start the binary here, as run-server-debug.mjs does.
const out = "dist/server/nextgen-dev";

try {
  if (!isHelp(args) && args[0] !== "migrate" && args[0] !== "completion") {
    const build = runnerCommand(["console:build", "login-ui:build"]);
    await run(build.command, build.args, { cwd: repoRoot });
  }
  await run("go", ["build", "-o", join(repoRoot, out), "."], { cwd: serverModuleRoot(repoRoot) });
  await run(join(repoRoot, out), args, { cwd: repoRoot });
} catch (error) {
  console.error(error.message);
  process.exit(error.code ?? 1);
}

function isHelp(args) {
  return args.includes("--help") || args.includes("-h") || args[0] === "help";
}

function withServerMigrateArgs(args) {
  if (isHelp(args) || args.includes("--migrate")) {
    return args;
  }
  if (args[0] === "migrate" || args[0] === "completion") {
    return args;
  }
  return [...args, "--migrate"];
}
