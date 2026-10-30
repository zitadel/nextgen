import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { optionArgs } from "./public-cli";
import { shellOption } from "./shell";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export type PackageCommand = {
  command: PackageManager;
  args: string[];
  display: string;
};

export async function detectPackageManager(cwd: string): Promise<PackageManager> {
  const declared = await packageManagerFromManifest(cwd);
  if (declared) {
    return declared;
  }
  if (await exists(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (await exists(join(cwd, "yarn.lock"))) return "yarn";
  if (await exists(join(cwd, "bun.lock"))) return "bun";
  if (await exists(join(cwd, "bun.lockb"))) return "bun";
  if (await exists(join(cwd, "package-lock.json"))) return "npm";
  return "npm";
}

export function installCommandFor(packageManager: PackageManager): PackageCommand {
  return command(packageManager, ["install"]);
}

/**
 * Adds (or re-pins) the given `name@version` specs at exactly those versions.
 * Every manager saves a caret range by default, which would silently turn an
 * exact pin into a float — the exact-save flag keeps the written specifier
 * identical to the requested version.
 */
export function addExactCommandFor(
  packageManager: PackageManager,
  packages: ReadonlyArray<string>,
): PackageCommand {
  switch (packageManager) {
    case "npm":
      return command("npm", ["install", "--save-exact", ...packages]);
    case "pnpm":
      return command("pnpm", ["add", "--save-exact", ...packages]);
    case "yarn":
      return command("yarn", ["add", "--exact", ...packages]);
    case "bun":
      return command("bun", ["add", "--exact", ...packages]);
  }
}

export function devCommandFor(packageManager: PackageManager): PackageCommand {
  switch (packageManager) {
    case "npm":
      return command("npm", ["run", "dev"]);
    case "pnpm":
      return command("pnpm", ["dev"]);
    case "yarn":
      return command("yarn", ["dev"]);
    case "bun":
      return command("bun", ["run", "dev"]);
  }
}

/**
 * The flag that runs a package manager in another directory, and whether a
 * relative directory may be given to it: npm's `--prefix` and pnpm's `--dir`
 * read one from the shell's directory, while bun documents `--cwd` as an
 * absolute path and Yarn 2+ has mishandled relative ones, so those two get the
 * resolved directory.
 */
const DIRECTORY_FLAG: Record<PackageManager, { flag: string; relative: boolean }> = {
  npm: { flag: "--prefix", relative: true },
  pnpm: { flag: "--dir", relative: true },
  yarn: { flag: "--cwd", relative: false },
  bun: { flag: "--cwd", relative: false },
};

/**
 * `packageCommand` as suggested from the shell's directory when the project is
 * elsewhere (`npm --prefix app run dev`), for a run given `--cwd`. Each
 * suggested command runs in a shell of its own, so a `cd` in front of one would
 * not carry over to the next.
 *
 * @param typed - `--cwd` as typed; `undefined` leaves the command as it is.
 * @param resolved - The same directory, absolute.
 */
export function inDirectory(
  packageCommand: PackageCommand,
  typed: string | undefined,
  resolved: string,
): PackageCommand {
  if (typed === undefined) {
    return packageCommand;
  }
  const { flag, relative } = DIRECTORY_FLAG[packageCommand.command];
  const dir = relative ? typed : resolved;
  return {
    command: packageCommand.command,
    args: [...optionArgs(flag, dir), ...packageCommand.args],
    display: [packageCommand.command, shellOption(flag, dir), ...packageCommand.args].join(" "),
  };
}

export async function runPackageCommand(
  packageCommand: PackageCommand,
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    redirectStdoutToStderr?: boolean;
  },
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(packageCommand.command, packageCommand.args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: options.redirectStdoutToStderr ? ["ignore", "pipe", "pipe"] : "inherit",
    });

    if (options.redirectStdoutToStderr) {
      child.stdout?.on("data", (chunk) => process.stderr.write(chunk));
      child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
    }

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = signal ? `signal ${signal}` : `exit ${String(code ?? 1)}`;
      const error = new Error(`${packageCommand.display} failed with ${detail}`);
      Object.assign(error, { code: code ?? 1, signal });
      reject(error);
    });
  });
}

function command(packageManager: PackageManager, args: string[]): PackageCommand {
  return {
    command: packageManager,
    args,
    display: [packageManager, ...args].join(" "),
  };
}

async function packageManagerFromManifest(cwd: string): Promise<PackageManager | undefined> {
  try {
    const raw = await readFile(join(cwd, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { packageManager?: unknown };
    return typeof parsed.packageManager === "string"
      ? packageManagerFromString(parsed.packageManager)
      : undefined;
  } catch {
    return undefined;
  }
}

function packageManagerFromString(value: string): PackageManager | undefined {
  const name = value.split("@")[0];
  return name === "npm" || name === "pnpm" || name === "yarn" || name === "bun" ? name : undefined;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
