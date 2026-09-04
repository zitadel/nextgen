#!/usr/bin/env node
import { fileURLToPath } from "node:url";

import { forwardedArgs, run } from "./dev-process.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const args = withServerMigrateArgs(forwardedArgs());

try {
  if (!isHelp(args) && args[0] !== "migrate") {
    await run("moon", ["run", "console:build", "login-ui:build"], { cwd: repoRoot });
  }
  await run("go", ["run", ".", ...args], { cwd: repoRoot });
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
