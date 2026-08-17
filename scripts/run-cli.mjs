#!/usr/bin/env node
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  localRegistryPaths,
  localRegistryPort,
  prepareLocalRegistry,
  stopLocalRegistry,
} from "../apps/cli-journey-e2e/scripts/local-registry.mjs";
import { buildLocalRuntimeImage, LOCAL_RUNTIME_IMAGE } from "./build-local-runtime-image.mjs";
import { forwardedArgs, isDirectRun, run, runCapture } from "./dev-process.mjs";
import { readServerBuildMetadata } from "./server-build.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const cliBin = join(repoRoot, "apps/cli/bin/run.js");
const localServerBinary = join(repoRoot, "dist/server/nextgen");
const localServerMetadata = join(repoRoot, "dist/server/metadata.json");
const localRegistryWorkDir = join(repoRoot, "tmp", "cli-local-registry");

export async function main(options = {}) {
  const args = options.args ?? forwardedArgs();
  const env = options.env ?? process.env;
  const runFn = options.run ?? run;
  const runCaptureFn = options.runCapture ?? runCapture;
  const buildCliFn = options.buildCli ?? buildCli;
  const buildLocalServerBinaryFn = options.buildLocalServerBinary ?? buildLocalServerBinary;
  const buildLocalRuntimeImageFn = options.buildLocalRuntimeImage ?? buildLocalRuntimeImage;
  const prepareLocalRegistryFn = options.prepareLocalRegistry ?? prepareLocalRegistry;
  const stopLocalRegistryFn = options.stopLocalRegistry ?? stopLocalRegistry;
  const stderr = options.stderr ?? process.stderr;
  const cliEnv = { ...env };
  const cliCwd = options.cwd ?? cliCwdFor(env);
  let registryProcess;

  await buildCliFn({ env });

  if (shouldUseLocalServerBinary(args, env)) {
    const localServer = await buildLocalServerBinaryFn({ env });
    cliEnv.ZITADEL_SERVER_BINARY = localServer.path;
    cliEnv.ZITADEL_SERVER_BINARY_VERSION = localServer.version;
  }

  if (shouldPrepareLocalPackages(args, env)) {
    const registryWorkDir = options.localRegistryWorkDir ?? localRegistryWorkDir;
    const registryPort = localRegistryPort(repoRoot, env);
    const registryUrl = `http://127.0.0.1:${registryPort}`;
    const registryPaths = localRegistryPaths(registryWorkDir);
    const packageRegistry = await prepareLocalRegistryFn({
      env,
      log: (message) => {
        stderr.write(`[zitadel-cli] ${message}\n`);
      },
      onStarted: (registry) => {
        registryProcess = registry;
      },
      paths: registryPaths,
      registryPort,
      registryUrl,
      repoRoot,
      run: wrapperRun({ jsonMode: hasJsonFlag(args), runCaptureFn, runFn, stderr }),
      workDir: registryWorkDir,
    });
    registryProcess = packageRegistry.registry;
    Object.assign(cliEnv, packageRegistry.env);
  }

  if (shouldAutoBuildLocalRuntimeImage(args, env)) {
    await buildLocalRuntimeImageFn({ env });
    cliEnv.ZITADEL_LOCAL_IMAGE = LOCAL_RUNTIME_IMAGE;
  }

  try {
    await runFn(process.execPath, [cliBin, ...args], { cwd: cliCwd, env: cliEnv });
  } finally {
    if (registryProcess) {
      await stopLocalRegistryFn(registryProcess);
    }
  }
}

export function shouldAutoBuildLocalRuntimeImage(args, env = process.env) {
  return (
    commandName(args) === "start" &&
    runtimeFlagValue(args, env) === "docker" &&
    !hasRuntimeImageSource(args, env) &&
    !isHelpOrVersion(args)
  );
}

export function shouldUseLocalServerBinary(args, env = process.env) {
  return (
    commandName(args) === "start" &&
    runtimeFlagValue(args, env) === "binary" &&
    !hasFlag(args, "--dry-run") &&
    !env.ZITADEL_SERVER_BINARY &&
    !isHelpOrVersion(args)
  );
}

export function shouldPrepareLocalPackages(args, env = process.env) {
  return (
    commandName(args) === "setup" &&
    !isHelpOrVersion(args) &&
    !hasFlag(args, "--dry-run") &&
    !hasFlag(args, "--skip-install") &&
    !usesPublicPackages(env)
  );
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

function hasRuntimeImageSource(args, env) {
  if (env.ZITADEL_LOCAL_IMAGE) {
    return true;
  }
  return hasFlag(args, "--image");
}

function hasJsonFlag(args) {
  return hasFlag(args, "--json");
}

function hasFlag(args, flag) {
  return args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
}

function runtimeFlagValue(args, env = process.env) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--runtime") {
      return args[index + 1];
    }
    if (arg.startsWith("--runtime=")) {
      return arg.slice("--runtime=".length);
    }
  }
  if (hasRuntimeImageSource(args, env)) {
    return "docker";
  }
  return "binary";
}

function isHelpOrVersion(args) {
  const command = commandName(args);
  return (
    command === "help" ||
    command === "version" ||
    args.some((arg) => arg === "--help" || arg === "-h" || arg === "--version")
  );
}

function usesPublicPackages(env) {
  const value = env.ZITADEL_CLI_USE_PUBLIC_PACKAGES;
  return value === "1" || value === "true";
}

function wrapperRun({ jsonMode, runCaptureFn, runFn, stderr }) {
  if (!jsonMode) {
    return runFn;
  }

  return async (command, args, options) => {
    try {
      const result = await runCaptureFn(command, args, options);
      if (result.stdout) {
        stderr.write(result.stdout);
      }
      if (result.stderr) {
        stderr.write(result.stderr);
      }
      return result;
    } catch (error) {
      if (typeof error === "object" && error !== null) {
        if ("stdout" in error && typeof error.stdout === "string" && error.stdout) {
          stderr.write(error.stdout);
        }
        if ("stderr" in error && typeof error.stderr === "string" && error.stderr) {
          stderr.write(error.stderr);
        }
      }
      throw error;
    }
  };
}

export function buildCli({ env = process.env } = {}) {
  return runMoonToStderr(["run", "cli:build"], "moon run cli:build", env);
}

export async function buildLocalServerBinary({ env = process.env } = {}) {
  // server:build deps console:build and login-ui:build, so one invocation
  // produces the fully embedded binary in graph order.
  await runMoonToStderr(["run", "server:build"], "moon run server:build", env);
  const metadata = await readServerBuildMetadata(localServerMetadata);
  return { path: localServerBinary, version: metadata.version };
}

function runMoonToStderr(args, label, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn("moon", args, {
      cwd: repoRoot,
      env,
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
      const error = new Error(`${label} failed with ${detail}`);
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
