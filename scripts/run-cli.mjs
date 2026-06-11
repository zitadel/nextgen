#!/usr/bin/env node
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildLocalRuntimeImage, LOCAL_RUNTIME_IMAGE } from "./build-local-runtime-image.mjs";
import { forwardedArgs, isDirectRun, run } from "./dev-process.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const cliBin = join(repoRoot, "apps/cli/bin/run.js");

export async function main(options = {}) {
  const args = options.args ?? forwardedArgs();
  const env = options.env ?? process.env;
  const runFn = options.run ?? run;
  const buildCliFn = options.buildCli ?? buildCli;
  const buildLocalRuntimeImageFn = options.buildLocalRuntimeImage ?? buildLocalRuntimeImage;
  const cliEnv = { ...env };
  const cliCwd = options.cwd ?? cliCwdFor(env);

  await buildCliFn();

  if (shouldAutoBuildLocalRuntimeImage(args, env)) {
    await buildLocalRuntimeImageFn({ env });
    cliEnv.ZITADEL_LOCAL_IMAGE = LOCAL_RUNTIME_IMAGE;
  }

  await runFn(process.execPath, [cliBin, ...args], { cwd: cliCwd, env: cliEnv });
}

export function shouldAutoBuildLocalRuntimeImage(args, env = process.env) {
  return commandName(args) === "start" && !hasImageOverride(args, env);
}

export function commandName(args) {
  const valueFlags = new Set(["--cwd", "-c", "--server", "-s"]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      return args[index + 1];
    }
    if (valueFlags.has(arg)) {
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      continue;
    }
    return arg;
  }
  return undefined;
}

export function cliCwdFor(env = process.env, fallback = process.cwd()) {
  return env.INIT_CWD || fallback;
}

function hasImageOverride(args, env) {
  if (env.ZITADEL_LOCAL_IMAGE) {
    return true;
  }
  return args.some((arg) => arg === "--image" || arg.startsWith("--image="));
}

export function buildCli() {
  return new Promise((resolve, reject) => {
    const child = spawn("corepack", ["pnpm", "nx", "build", "@zitadel/cli"], {
      cwd: repoRoot,
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

if (isDirectRun(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(exitCodeForError(error));
  }
}

function exitCodeForError(error) {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "number"
    ? error.code
    : 1;
}
