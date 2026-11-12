#!/usr/bin/env node
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { forwardedArgs, run, runCapture } from "./dev-process.mjs";
import { serverModuleRoot } from "./server-build.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const args = withServerMigrateArgs(forwardedArgs());

try {
  if (!isHelp(args) && args[0] !== "migrate" && args[0] !== "completion") {
    await run("turbo", ["run", "@zitadel/console#build"], { cwd: repoRoot });
  }
  // The module compiles in apps/api, but the server runs from the repository
  // root, as before the module moved: its default config search (`.`,
  // `./config`) and a relative --config path resolve against the checkout.
  // `go run` (and `go -C`) would run it inside the module, so build to dist
  // and start the binary here, as run-server-debug.mjs does.
  //
  // One binary per branch: the server keeps its data (the SQLite database,
  // the master key) in nextgen-data beside its executable unless configured
  // otherwise, so the dev data lives in dist/server/dev/<branch>/nextgen-data.
  // It survives rebuilds on the same branch, and a branch whose migrations
  // differ never runs them on another branch's database (goose tracks
  // version numbers only). server-debug keeps its own data in dist/server/.
  const out = join("dist", "server", "dev", await branchSlug(repoRoot), "nextgen");
  await run("go", ["build", "-o", join(repoRoot, out), "."], { cwd: serverModuleRoot(repoRoot) });
  await run(join(repoRoot, out), args, { cwd: repoRoot });
} catch (error) {
  console.error(error.message);
  process.exit(error.code ?? 1);
}

// The checked-out branch as a directory name: every run of characters that
// is not a letter, digit, dot or dash becomes one dash, so `muhlemmer/x`
// and `muhlemmer-x` share a directory, which is fine for dev data. A
// detached HEAD, where there is no branch, gets its own directory.
async function branchSlug(cwd) {
  let branch = "";
  try {
    branch = (
      await runCapture("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd })
    ).stdout.trim();
  } catch {
    // Not a checkout: the data gets the detached directory below.
  }
  if (!branch || branch === "HEAD") return "detached";
  return branch.replace(/[^A-Za-z0-9.-]+/g, "-").replace(/^[.-]+/, "") || "detached";
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
