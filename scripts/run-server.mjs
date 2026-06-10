#!/usr/bin/env node
import { forwardedArgs, run } from "./dev-process.mjs";

const args = forwardedArgs();

try {
  if (!isHelp(args)) {
    await run("sh", ["scripts/sync-embedded-ui-dist.sh", "all"]);
  }
  await run("go", ["run", ".", ...args]);
} catch (error) {
  console.error(error.message);
  process.exit(error.code ?? 1);
}

function isHelp(args) {
  return args.includes("--help") || args.includes("-h") || args[0] === "help";
}
