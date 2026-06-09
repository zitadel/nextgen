#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { forwardedArgs, run } from "./dev-process.mjs";

try {
  await buildCli();
  await run(process.execPath, ["apps/cli/bin/run.js", ...forwardedArgs()]);
} catch (error) {
  console.error(error.message);
  process.exit(error.code ?? 1);
}

function buildCli() {
  return new Promise((resolve, reject) => {
    const child = spawn("corepack", ["pnpm", "nx", "build", "@zitadel/cli"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => process.stderr.write(chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = signal ? `signal ${signal}` : `exit ${code}`;
      const error = new Error(`corepack pnpm nx build @zitadel/cli failed with ${detail}`);
      error.code = code;
      error.signal = signal;
      reject(error);
    });
  });
}
