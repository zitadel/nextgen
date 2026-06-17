#!/usr/bin/env node
import { spawn } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

export const supportedPlatforms = [
  { platform: "darwin", arch: "arm64", packageName: "@zitadel/server-darwin-arm64" },
  { platform: "darwin", arch: "x64", packageName: "@zitadel/server-darwin-x64" },
  { platform: "linux", arch: "arm64", packageName: "@zitadel/server-linux-arm64" },
  { platform: "linux", arch: "x64", packageName: "@zitadel/server-linux-x64" },
  { platform: "win32", arch: "x64", packageName: "@zitadel/server-win32-x64" },
];

export function platformPackageName(platform = process.platform, arch = process.arch) {
  const match = supportedPlatforms.find((candidate) => {
    return candidate.platform === platform && candidate.arch === arch;
  });
  if (!match) {
    const supported = supportedPlatforms
      .map((candidate) => `${candidate.platform}/${candidate.arch}`)
      .join(", ");
    throw new Error(`Unsupported platform for @zitadel/server: ${platform}/${arch}. Supported: ${supported}.`);
  }
  return match.packageName;
}

export function resolveServerBinary(platform = process.platform, arch = process.arch) {
  const packageName = platformPackageName(platform, arch);
  let manifestPath;
  try {
    manifestPath = require.resolve(`${packageName}/package.json`);
  } catch (error) {
    throw new Error(
      `Missing ${packageName}. Reinstall @zitadel/server so npm can install the optional platform package.`,
      { cause: error },
    );
  }

  const binaryName = platform === "win32" ? "nextgen.exe" : "nextgen";
  const binaryPath = join(dirname(manifestPath), "bin", binaryName);
  if (!existsSync(binaryPath)) {
    throw new Error(`Missing Zitadel server binary at ${binaryPath}. Reinstall ${packageName}.`);
  }
  ensureExecutable(binaryPath, platform);
  return binaryPath;
}

export function ensureExecutable(binaryPath, platform = process.platform) {
  if (platform === "win32") {
    return;
  }
  try {
    chmodSync(binaryPath, 0o755);
  } catch (error) {
    throw new Error(`Zitadel server binary at ${binaryPath} is not executable and could not be fixed.`, {
      cause: error,
    });
  }
}

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
