#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { resolveServerBinary } from "./binary.js";

export {
  ensureExecutable,
  platformPackageName,
  resolveServerBinary,
  supportedPlatforms,
} from "./binary.js";

export async function main(args = process.argv.slice(2)) {
  const binaryPath = resolveServerBinary();
  const child = spawn(binaryPath, args, { stdio: "inherit" });
  forwardShutdownSignals(child);
  child.on("error", (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

export function forwardShutdownSignals(child, proc = process) {
  const forward = (signal) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    child.kill(signal);
  };
  const onTerm = () => forward("SIGTERM");
  const onInt = () => forward("SIGINT");
  proc.once("SIGTERM", onTerm);
  proc.once("SIGINT", onInt);
  child.once("exit", () => {
    proc.off("SIGTERM", onTerm);
    proc.off("SIGINT", onInt);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
