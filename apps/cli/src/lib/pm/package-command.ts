import { execa } from "execa";

import { Cmd } from "@/lib/cmd";
import { Output } from "@/lib/ui/output";

import {
  PmCommandFailedError,
  PmCommandNotPermittedError,
  PmCommandNotStartedError,
} from "./errors";
import type { PMName } from "./pm";

/**
 * What a package manager's command may do: install, remove, or run a project's
 * own script. None runs a package the way `dlx`, `exec` or `x` would, so a
 * suggestion of one cannot run this CLI unchecked.
 */
export type Verb = "add" | "dev" | "install" | "remove" | "run" | "uninstall";

/** How a command is run in a directory. */
export type RunOptions = {
  /** The directory the package manager runs in. */
  cwd: string;
  /** The environment it starts with; the process's own when left out. */
  env?: NodeJS.ProcessEnv;
  /** Keeps its output off stdout, which `--json` reserves for the envelope. */
  redirectStdoutToStderr?: boolean;
  /**
   * Prints nothing; the error a failure throws carries the command's output,
   * stdout and stderr interleaved, as `output`.
   */
  captureOutput?: boolean;
};

/** Whatever runs a {@link PackageCommand}, so a test can stand in for the process. */
export type Runner = (command: PackageCommand, options: RunOptions) => Promise<void>;

/** Words that come before a command's verb: a flag and its value. */
type Leading = {
  /** The words as the package manager is passed them. */
  args: readonly string[];
  /** The same words as a person reads and runs them, quoted. */
  shown: readonly string[];
};

/**
 * The flag that runs a package manager in another directory, and whether a
 * relative directory may be given to it: npm's `--prefix` and pnpm's `--dir`
 * read one from the shell's directory, while bun documents `--cwd` as an
 * absolute path and Yarn 2+ has mishandled relative ones, so those two get the
 * resolved directory.
 */
const DIRECTORY_FLAG: Record<PMName, { flag: string; relative: boolean }> = {
  npm: { flag: "--prefix", relative: true },
  pnpm: { flag: "--dir", relative: true },
  yarn: { flag: "--cwd", relative: false },
  bun: { flag: "--cwd", relative: false },
};

/**
 * One command of a package manager: what it does, the words it is passed and
 * how a person reads it. A {@link PM} makes them, so the verb is
 * recorded when the command is built and never read back from its words.
 */
export class PackageCommand {
  /** The package manager that runs it. */
  readonly manager: PMName;

  /** What it does. */
  readonly verb: Verb;

  /** The words after the verb: its options, then the packages or the script. */
  readonly operands: readonly string[];

  /** Words before the verb, such as a workspace filter. */
  private readonly leading: Leading;

  /**
   * @param manager - The package manager that runs it.
   * @param verb - What it does.
   * @param operands - The words after the verb: its options, then the packages
   *   or the script.
   * @param leading - Words before the verb, such as a workspace filter.
   */
  constructor(
    manager: PMName,
    verb: Verb,
    operands: readonly string[],
    leading: Leading = { args: [], shown: [] },
  ) {
    this.manager = manager;
    this.verb = verb;
    this.operands = operands;
    this.leading = leading;
  }

  /** Every word passed to the package manager, options before the verb included. */
  get args(): string[] {
    return [...this.leading.args, this.verb, ...this.operands];
  }

  /** The command as the person reads and runs it. */
  get display(): string {
    return [this.manager, ...this.leading.shown, this.verb, ...this.operands].join(" ");
  }

  /**
   * This command as suggested from the shell's directory when the project is
   * elsewhere (`npm --prefix app run dev`), for a run given `--cwd`. Each
   * suggested command runs in a shell of its own, so a `cd` in front of one
   * would not carry over to the next.
   *
   * @param typed - `--cwd` as typed; `undefined` leaves the command as it is.
   * @param resolved - The same directory, absolute.
   * @returns The command aimed at the directory.
   */
  inDirectory(typed: string | undefined, resolved: string): PackageCommand {
    if (typed === undefined) {
      return this;
    }
    const { flag, relative } = DIRECTORY_FLAG[this.manager];
    const dir = relative ? typed : resolved;
    return new PackageCommand(this.manager, this.verb, this.operands, {
      args: [...Cmd.optionArgs(flag, dir), ...this.leading.args],
      shown: [Cmd.option(flag, dir), ...this.leading.shown],
    });
  }

  /**
   * Runs the command in `options.cwd`, its output on the terminal unless
   * `redirectStdoutToStderr` keeps it off stdout or `captureOutput` keeps it
   * off the terminal altogether.
   *
   * @param options - Where and how it runs.
   * @throws {@link PmCommandNotStartedError} When the program or its directory is not there.
   * @throws {@link PmCommandNotPermittedError} When the operating system refuses to run it.
   * @throws {@link PmCommandFailedError} When the command cannot start otherwise or exits non-zero.
   */
  async run(options: RunOptions): Promise<void> {
    const capture = options.captureOutput === true;
    const subprocess = execa(this.manager, this.args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      extendEnv: false,
      stdio:
        capture || (options.redirectStdoutToStderr ?? Output.json)
          ? ["ignore", "pipe", "pipe"]
          : "inherit",
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
      const message = result.originalMessage ?? result.message ?? "";
      if (result.code === "ENOENT") {
        throw new PmCommandNotStartedError(message, result.code);
      }
      if (result.code === "EACCES" || result.code === "EPERM") {
        throw new PmCommandNotPermittedError(message, result.code);
      }
      throw new PmCommandFailedError(message, {
        exit: result.code,
      });
    }
    if (result.failed) {
      const detail = result.signal
        ? `signal ${result.signal}`
        : `exit ${String(result.exitCode ?? 1)}`;
      throw new PmCommandFailedError(`${this.display} failed with ${detail}`, {
        exit: result.exitCode ?? 1,
        signal: result.signal ?? null,
        ...(capture
          ? {
              output: String(result.all ?? ""),
            }
          : {}),
      });
    }
  }
}
