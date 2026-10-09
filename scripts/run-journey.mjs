#!/usr/bin/env node
import { forwardedArgs, run } from "./dev-process.mjs";

try {
  await run(process.execPath, ["e2e/journey/scripts/run-local.mjs", ...forwardedArgs()]);
} catch (error) {
  console.error(error.message);
  process.exit(error.code ?? 1);
}
