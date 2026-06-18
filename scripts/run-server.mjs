#!/usr/bin/env node
import { fileURLToPath } from "node:url";

import { forwardedArgs, run } from "./dev-process.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const args = forwardedArgs();

try {
  if (!isHelp(args)) {
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
