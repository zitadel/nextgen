import { dirname, join, resolve } from "node:path";

import { pathExists } from "@/lib/fs";
import { Output } from "@/lib/ui/output";

import { Manifest, type PackageJson } from "./manifest";
import { PackageCommand, type Runner, type Verb } from "./package-command";

/** The package managers a project may use. */
export type PMName = "npm" | "pnpm" | "yarn" | "bun";

/** Each lockfile, and the package manager that writes it, in the order they are looked for. */
const LOCKFILES = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
] as const satisfies ReadonlyArray<readonly [string, PMName]>;

/** Why an install did not run. */
type InstallReason = "dry-run" | "skip-install" | "no-dependency-changes";

/** What a command's dependency install did, as its envelope reports it. */
export type DependencyInstall = {
  status: "completed" | "would-run" | "skipped" | "not-needed";
  package_manager: PMName;
  command: string;
  reason?: InstallReason;
};

/** What a command decided about one install. */
export type InstallPlan = {
  /** Whether the command added anything to `package.json`. */
  needed: boolean;
  /** Names the command without running it. */
  dryRun: boolean;
  /** `--skip-install`: names the command without running it. */
  skipInstall: boolean;
};

/** Where an install runs and how the run goes. */
export type InstallContext = {
  /** The project's directory. */
  cwd: string;
  /** The environment the package manager starts with. */
  env: NodeJS.ProcessEnv;
  /** Keeps the package manager's output off stdout, which `--json` reserves. */
  json?: boolean;
  /** Draws the step: the command's `this.ui.task`. */
  task: <T>(label: string, work: () => Promise<T>, done?: (result: T) => string) => Promise<T>;
  /** Narrates the step when it is not drawn as a task: the CLI's `log`. */
  log: { start(message: string): void; done(message: string): void };
  /** The error a failed install becomes. */
  failed: (error: unknown, command: PackageCommand) => Error;
  /** What stands in for the process, for a test. */
  run?: Runner;
};

/** What an install did, and the command it ran or would run. */
export type InstallResult = { install: DependencyInstall; command: PackageCommand };

/**
 * A project's package manager, and everything the CLI asks of it. It builds
 * every command, so each carries the verb it was built for; a command is
 * never put together from words elsewhere. It is the one way into this area:
 * the project's `package.json` and installing its dependencies are reached
 * through it.
 */
export class PM {
  /** Which package manager it is. */
  readonly name: PMName;

  /**
   * @param name - Which package manager it is.
   */
  private constructor(name: PMName) {
    this.name = name;
  }

  /**
   * A package manager known by name, such as the one a command is suggested
   * for without a project to read.
   *
   * @param name - The package manager.
   * @returns It.
   */
  static named(name: PMName): PM {
    return new PM(name);
  }

  /**
   * The package manager the project in `cwd` uses. A workspace keeps its
   * lockfile and its `packageManager` field at the repository's root, not in
   * each app, so every directory from `cwd` up to the one holding `.git` is
   * read, nearest first.
   *
   * @param cwd - The project's directory.
   * @returns What the nearest `packageManager` field or lockfile names, or npm
   *   when none does.
   */
  static async detect(cwd: string): Promise<PM> {
    for (const dir of await PM.projectDirectories(cwd)) {
      const named = await PM.namedIn(dir);
      if (named !== undefined) {
        return new PM(named);
      }
    }
    return new PM("npm");
  }

  /**
   * Reads and parses the `package.json` that sits directly in `dir`, which
   * must exist and be a JSON object.
   *
   * @param dir - The project directory that holds the `package.json`.
   * @returns The parsed file.
   * @throws An `ENOENT` error when there is none, a `SyntaxError` when it is
   *   not valid JSON, and an `Error` when its root is not an object.
   */
  static async manifest(dir: string): Promise<PackageJson> {
    return (await Manifest.read(dir)).json;
  }

  /**
   * Reads the `package.json` in `dir`, treating a missing file as "this is not
   * an npm project" rather than a failure.
   *
   * @param dir - The project directory that would hold the `package.json`.
   * @returns The manifest, or `undefined` when there is none.
   * @throws When the file exists but is unreadable or corrupt.
   */
  static async manifestIfExists(dir: string): Promise<PackageJson | undefined> {
    return (await Manifest.readIfExists(dir))?.json;
  }

  /**
   * Installs what a command added to `package.json`. Nothing to install is
   * `not-needed`; a dry run or `--skip-install` names the command without
   * running it.
   *
   * @param plan - What the command decided.
   * @param context - Where to install and how the run goes.
   * @returns What the install did, and the command it ran or would run.
   * @throws What `context.failed` returns, when the package manager fails.
   */
  async installDependencies(plan: InstallPlan, context: InstallContext): Promise<InstallResult> {
    const command = this.install();
    const report = (status: DependencyInstall["status"], reason?: InstallReason) => {
      return {
        install: {
          status,
          package_manager: this.name,
          command: command.display,
          ...(reason === undefined ? {} : { reason }),
        },
        command,
      };
    };

    if (!plan.needed) {
      return report("not-needed", "no-dependency-changes");
    }
    if (plan.dryRun) {
      return report("would-run");
    }
    if (plan.skipInstall) {
      return report("skipped", "skip-install");
    }

    const label = `Installing dependencies with ${command.display}`;
    const run = async (): Promise<void> => {
      try {
        const options = {
          cwd: context.cwd,
          env: context.env,
          redirectStdoutToStderr: context.json ?? Output.json,
        };
        await (context.run === undefined ? command.run(options) : context.run(command, options));
      } catch (error) {
        throw context.failed(error, command);
      }
    };

    if (context.json) {
      await context.task(label, run, () => {
        return "Installed dependencies";
      });
    } else {
      // The package manager writes to the terminal itself, so no spinner may draw over it.
      context.log.start(label);
      await run();
      context.log.done("Installed dependencies");
    }
    return report("completed");
  }

  /**
   * Installs what `package.json` lists.
   *
   * @returns The command.
   */
  install(): PackageCommand {
    return this.command("install", []);
  }

  /**
   * Installs `packages` with npm's `install` or the others' `add`, at whatever
   * version each spec names: `npm install @zitadel/cli@latest`.
   *
   * @param packages - The `name@version` specs.
   * @returns The command.
   */
  add(packages: ReadonlyArray<string>): PackageCommand {
    return this.command(this.name === "npm" ? "install" : "add", packages);
  }

  /**
   * Adds (or re-pins) the given `name@version` specs at exactly those versions.
   * Every manager saves a caret range by default, which would silently turn an
   * exact pin into a float: the exact-save flag keeps the written specifier
   * identical to the requested version.
   *
   * @param packages - The `name@version` specs.
   * @returns The command.
   */
  addExact(packages: ReadonlyArray<string>): PackageCommand {
    switch (this.name) {
      case "npm":
        return this.command("install", ["--save-exact", ...packages]);
      case "pnpm":
        return this.command("add", ["--save-exact", ...packages]);
      case "yarn":
        return this.command("add", ["--exact", ...packages]);
      case "bun":
        return this.command("add", ["--exact", ...packages]);
    }
  }

  /**
   * Removes `packages` with npm's `uninstall` or the others' `remove`.
   *
   * @param packages - The packages' names.
   * @returns The command.
   */
  remove(packages: ReadonlyArray<string>): PackageCommand {
    return this.command(this.name === "npm" ? "uninstall" : "remove", packages);
  }

  /**
   * Starts the project's dev server, the way each manager spells it.
   *
   * @returns The command.
   */
  dev(): PackageCommand {
    switch (this.name) {
      case "npm":
        return this.command("run", ["dev"]);
      case "pnpm":
        return this.command("dev", []);
      case "yarn":
        return this.command("dev", []);
      case "bun":
        return this.command("run", ["dev"]);
    }
  }

  /**
   * Runs one of the project's `package.json` scripts.
   *
   * @param script - The script's name.
   * @returns The command.
   */
  script(script: string): PackageCommand {
    return this.command("run", [script]);
  }

  /**
   * A command that does `verb`, with `operands` after it.
   *
   * @param verb - What it does.
   * @param operands - The words after the verb.
   * @returns The command.
   */
  private command(verb: Verb, operands: ReadonlyArray<string>): PackageCommand {
    return new PackageCommand(this.name, verb, operands);
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
  private static async projectDirectories(
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
    return PM.projectDirectories(parent, dirs);
  }

  /**
   * The package manager `dir` itself names: its `package.json`'s
   * `packageManager` field first, then the first lockfile it holds.
   *
   * @param dir - A directory.
   * @returns The package manager, or `undefined` when `dir` names none.
   */
  private static async namedIn(dir: string): Promise<PMName | undefined> {
    const declared = await PM.declaredIn(dir);
    if (declared !== undefined) {
      return declared;
    }
    for (const [lockfile, name] of LOCKFILES) {
      if (await pathExists(join(dir, lockfile))) {
        return name;
      }
    }
    return undefined;
  }

  /**
   * The package manager `dir`'s `package.json` declares in its
   * `packageManager` field (`pnpm@9.1.0`).
   *
   * @param dir - A directory.
   * @returns The package manager, or `undefined` when there is no readable
   *   manifest or it names none.
   */
  private static async declaredIn(dir: string): Promise<PMName | undefined> {
    const manifest = await Manifest.read(dir).catch(() => {
      return undefined;
    });
    const declared = manifest?.json.packageManager;
    if (typeof declared !== "string") {
      return undefined;
    }
    const name = declared.split("@")[0];
    return name === "npm" || name === "pnpm" || name === "yarn" || name === "bun"
      ? name
      : undefined;
  }
}
