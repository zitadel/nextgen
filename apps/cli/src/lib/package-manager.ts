import { dirname, join, resolve } from "node:path";
import { execa } from "execa";

import { Cmd } from "./cmd";
import { pathExists } from "./fs";
import { readPackageJson } from "./npm";
import { optionArgs } from "./public-cli";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

/**
 * What a package manager's command may do: install, remove, or run a project's
 * own script. None runs a package the way `dlx`, `exec` or `x` would, so a
 * suggestion of one cannot run this CLI unchecked.
 */
export type Verb = "add" | "dev" | "install" | "remove" | "run" | "uninstall";

/** A package manager's command, as each builder here makes it. */
export type PackageCommand = {
  /** The package manager. */
  command: PackageManager;
  /** What it does, recorded by the builder rather than read back from `args`. */
  verb: Verb;
  /** The words after the verb: its options, then the packages or the script. */
  operands: readonly string[];
  /** Every word passed to the package manager, options before the verb included. */
  args: string[];
  /** The command as the person reads and runs it. */
  display: string;
};

/** Each lockfile, and the package manager that writes it, in the order they are looked for. */
const LOCKFILES = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
] as const satisfies ReadonlyArray<readonly [string, PackageManager]>;

/**
 * The package manager the project in `cwd` uses. A workspace keeps its
 * lockfile and its `packageManager` field at the repository's root, not in
 * each app, so every directory from `cwd` up to the one holding `.git` is
 * read, nearest first ({@link projectDirectories}).
 *
 * @param cwd - The project's directory.
 * @returns What the nearest `packageManager` field or lockfile names, or npm
 *   when none does.
 */
export async function detectPackageManager(cwd: string): Promise<PackageManager> {
  for (const dir of await projectDirectories(cwd)) {
    const named = await packageManagerIn(dir);
    if (named !== undefined) {
      return named;
    }
  }
  return "npm";
}

/**
 * The directories whose files say which package manager `cwd` uses: `cwd`
 * and each one above it, up to and including the repository's root (the one
 * holding `.git`). Outside a repository only `cwd`, so nothing above a
 * project, such as a home directory's stray lockfile, can choose for it.
 *
 * @param cwd - The project's directory.
 * @param below - The directories already walked, nearest first.
 * @returns The directories, nearest first.
 */
async function projectDirectories(
  cwd: string,
  below: readonly string[] = [],
): Promise<readonly string[]> {
  const dir = resolve(cwd);
  const dirs = [...below, dir];
  if (await pathExists(join(dir, ".git"))) {
    return dirs;
  }
  const parent = dirname(dir);
  if (parent === dir) {
    // No project root above: only the directory the walk began in counts.
    return [below[0] ?? dir];
  }
  return projectDirectories(parent, dirs);
}

/**
 * The package manager `dir` itself names: its `package.json`'s
 * `packageManager` field first, then the first lockfile it holds.
 *
 * @param dir - A directory.
 * @returns The package manager, or `undefined` when `dir` names none.
 */
async function packageManagerIn(dir: string): Promise<PackageManager | undefined> {
  const declared = await packageManagerFromManifest(dir);
  if (declared !== undefined) {
    return declared;
  }
  for (const [lockfile, packageManager] of LOCKFILES) {
    if (await pathExists(join(dir, lockfile))) {
      return packageManager;
    }
  }
  return undefined;
}

export function installCommandFor(packageManager: PackageManager): PackageCommand {
  return command(packageManager, "install", []);
}

/**
 * Installs `packages` with npm's `install` or the others' `add`, at whatever
 * version each spec names: `npm install @zitadel/cli@latest`.
 *
 * @param packageManager - The project's package manager.
 * @param packages - The `name@version` specs.
 * @returns The command.
 */
export function addCommandFor(
  packageManager: PackageManager,
  packages: ReadonlyArray<string>,
): PackageCommand {
  return command(packageManager, packageManager === "npm" ? "install" : "add", packages);
}

/**
 * Removes `packages` with npm's `uninstall` or the others' `remove`.
 *
 * @param packageManager - The project's package manager.
 * @param packages - The packages' names.
 * @returns The command.
 */
export function removeCommandFor(
  packageManager: PackageManager,
  packages: ReadonlyArray<string>,
): PackageCommand {
  return command(packageManager, packageManager === "npm" ? "uninstall" : "remove", packages);
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
      return command("npm", "install", ["--save-exact", ...packages]);
    case "pnpm":
      return command("pnpm", "add", ["--save-exact", ...packages]);
    case "yarn":
      return command("yarn", "add", ["--exact", ...packages]);
    case "bun":
      return command("bun", "add", ["--exact", ...packages]);
  }
}

export function devCommandFor(packageManager: PackageManager): PackageCommand {
  switch (packageManager) {
    case "npm":
      return command("npm", "run", ["dev"]);
    case "pnpm":
      return command("pnpm", "dev", []);
    case "yarn":
      return command("yarn", "dev", []);
    case "bun":
      return command("bun", "run", ["dev"]);
  }
}

/**
 * Runs one of the project's `package.json` scripts.
 */
export function runScriptCommandFor(
  packageManager: PackageManager,
  script: string,
): PackageCommand {
  return command(packageManager, "run", [script]);
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
    verb: packageCommand.verb,
    operands: packageCommand.operands,
    args: [...optionArgs(flag, dir), ...packageCommand.args],
    display: [packageCommand.command, Cmd.option(flag, dir), ...packageCommand.args].join(" "),
  };
}

/**
 * Runs a package manager's command in `cwd`, its output on the terminal unless
 * `redirectStdoutToStderr` keeps it off stdout or `captureOutput` keeps it
 * off the terminal altogether.
 *
 * @param options.captureOutput - Prints nothing; the error a failure throws
 *   carries the command's output, stdout and stderr interleaved, as `output`.
 * @throws When the command cannot start or exits non-zero.
 */
export async function runPackageCommand(
  packageCommand: PackageCommand,
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    redirectStdoutToStderr?: boolean;
    captureOutput?: boolean;
  },
): Promise<void> {
  const capture = options.captureOutput === true;
  const subprocess = execa(packageCommand.command, packageCommand.args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    extendEnv: false,
    stdio: capture || options.redirectStdoutToStderr ? ["ignore", "pipe", "pipe"] : "inherit",
    all: capture,
    reject: false,
  });
  if (!capture) {
    // Piped through `process.stderr.write` rather than handed the descriptor, so
    // anything that wraps that stream (the test harness, a progress UI) sees it.
    subprocess.stdout?.pipe(process.stderr, { end: false });
    subprocess.stderr?.pipe(process.stderr, { end: false });
  }
  const result = await subprocess;
  if (result.code !== undefined && result.exitCode === undefined) {
    throw Object.assign(new Error(result.originalMessage ?? result.message), {
      code: result.code,
    });
  }
  if (result.failed) {
    const detail = result.signal
      ? `signal ${result.signal}`
      : `exit ${String(result.exitCode ?? 1)}`;
    const error = new Error(`${packageCommand.display} failed with ${detail}`);
    Object.assign(error, {
      code: result.exitCode ?? 1,
      signal: result.signal ?? null,
      ...(capture ? { output: String(result.all ?? "") } : {}),
    });
    throw error;
  }
}

/**
 * A package manager's command that does `verb`, with `operands` after it.
 *
 * @param packageManager - The package manager.
 * @param verb - What it does.
 * @param operands - The words after the verb.
 * @returns The command.
 */
function command(
  packageManager: PackageManager,
  verb: Verb,
  operands: ReadonlyArray<string>,
): PackageCommand {
  return {
    command: packageManager,
    verb,
    operands,
    args: [verb, ...operands],
    display: [packageManager, verb, ...operands].join(" "),
  };
}

async function packageManagerFromManifest(cwd: string): Promise<PackageManager | undefined> {
  const pkg = await readPackageJson(cwd).catch(() => {
    return undefined;
  });
  return typeof pkg?.packageManager === "string"
    ? packageManagerFromString(pkg.packageManager)
    : undefined;
}

function packageManagerFromString(value: string): PackageManager | undefined {
  const name = value.split("@")[0];
  return name === "npm" || name === "pnpm" || name === "yarn" || name === "bun" ? name : undefined;
}
