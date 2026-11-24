import { byName } from "@/lib/names";
import { resolveCwd } from "@/lib/paths";
import type { Scope } from "@/lib/suggestion";
import { typedScopeOf } from "@/lib/suggestion/run";

import type { FlagVariable, GlobalOptions } from "./types";

/**
 * The colour variables, which `bin/run.js` sets from `--color`/`--no-color`
 * and the colour libraries read. The libraries agree that off wins.
 */
export const NO_COLOR: FlagVariable = {
  name: "NO_COLOR",
  flag: "color",
  description: "A non-empty value turns color off, as `--no-color` does (https://no-color.org).",
  precedence: "Turns color off even with `--color` or `FORCE_COLOR`.",
};

/** The variable that turns colour on where it would be off, such as in a pipe. */
export const FORCE_COLOR: FlagVariable = {
  name: "FORCE_COLOR",
  flag: "color",
  description:
    "Turns color on where it would be off, such as in a pipe, as `--color` does; `0` or `false` turns it off.",
  precedence: "`--no-color` and `NO_COLOR` win over it.",
};

/** What a command says of itself, for a run to settle its context from. */
export type CommandFacts = Readonly<{
  /** The command's id, as oclif names it, if it has one. */
  id: string | undefined;
  /** The CLI's version. */
  version: string;
  /** What the command's `static meta` fixes, which wins over resolving a server. */
  source?: string;
  /** Whether the command declares `--server`. */
  takesServer: boolean;
  /** Resolves the server of a command that names none of its own. */
  resolveServer: (cwd: string, serverFlag: string | undefined) => Promise<string>;
}>;

/**
 * What a run is, settled once before any work: the directory it addresses, the
 * server it is about, whether anyone can be asked, and how its output is
 * coloured. It knows nothing of the command running it: it reads the flags it
 * is handed, or the words typed when a failure came before any flag was
 * parsed, so a failure's envelope names the same `source` and carries the same
 * `--cwd` as one raised later.
 *
 * ```ts
 * const context = await RunContext.from(flags, { id, version, takesServer, resolveServer }, json);
 * context.meta; // GlobalOptions
 * ```
 */
export class RunContext {
  /** The run's context, as commands and the envelope read it. */
  readonly meta: GlobalOptions;

  /** How the command line chose the project, as typed, which the commands this run suggests carry. */
  readonly scope: Scope;

  /** Whether the output is drawn in colour: `--no-color` and `NO_COLOR` win, `FORCE_COLOR` and a terminal turn it on. */
  readonly colored: boolean;

  /**
   * @param meta - The run's context.
   * @param scope - How the command line chose the project, as typed.
   * @param colored - Whether the output is drawn in colour.
   */
  private constructor(meta: GlobalOptions, scope: Scope, colored: boolean) {
    this.meta = meta;
    this.scope = scope;
    this.colored = colored;
  }

  /**
   * Reads the context from parsed flags.
   *
   * `--no-color` (or the `NO_COLOR` env) turns colour off; both reach this
   * process as `NO_COLOR` via `bin/run.js`, and `--no-color` also unsets the
   * parsed `color` flag. The flag's value is the source of truth here so that a
   * programmatic `run()` (tests) honours it without the entry-point shim.
   *
   * Colour is about where the output goes, so it asks stdout alone. `isTTY` is
   * about whether a person can be asked something and needs stdin too: a run
   * with its stdin redirected still writes to a terminal that reads colour.
   *
   * @param given - The parsed flags.
   * @param reading - What the command says of itself.
   * @param json - Whether `--json` is on.
   * @returns The context.
   */
  static async from(
    given: Record<string, unknown>,
    reading: CommandFacts,
    json: boolean,
  ): Promise<RunContext> {
    const flags = byName(given);
    const cwd = resolveCwd(typeof flags.cwd === "string" ? flags.cwd : undefined);
    const serverFlag =
      reading.takesServer && typeof flags.server === "string" ? flags.server : undefined;
    const scope = typedScopeOf({
      cwd: flags.cwd,
      env: flags.env,
      envFile: flags.envFile,
      server: serverFlag,
    });
    const source = await RunContext.sourceOf(reading, cwd, serverFlag);
    const isTTY = RunContext.isTerminal();
    const useColor =
      flags.color !== false &&
      !process.env[NO_COLOR.name] &&
      RunContext.forcedColour(process.env) !== false;
    const colored =
      useColor &&
      (RunContext.forcedColour(process.env) === true ||
        (Boolean(process.stdout.isTTY) && process.env.TERM !== "dumb"));

    return new RunContext(
      {
        cwd,
        nonInteractive: Boolean(flags.nonInteractive) || !isTTY || json,
        dryRun: Boolean(flags.dryRun),
        force: Boolean(flags.force),
        command: reading.id ?? "(default)",
        cliVersion: reading.version,
        source,
        serverFlag,
        verbose: Boolean(flags.verbose),
        debug: Boolean(flags.debug),
        env: process.env,
        isTTY,
      },
      scope,
      colored,
    );
  }

  /**
   * Reads what the command line says of the run before any flag was parsed,
   * for a failure that came from parsing: the directory and server it named. A
   * value that cannot be read is left as the failure's own to report.
   *
   * @param meta - The context the run had, which this refines.
   * @param argv - The words the command was run with.
   * @param reading - What the command says of itself.
   * @returns The context, with the typed directory and server.
   */
  static async fromArgv(
    meta: GlobalOptions,
    argv: readonly string[],
    reading: CommandFacts,
  ): Promise<RunContext> {
    const typed = RunContext.argvValue(argv, "--cwd", "-c");
    const serverFlag = reading.takesServer
      ? RunContext.argvValue(argv, "--server", "-s")
      : undefined;
    const scope = typedScopeOf({
      cwd: typed,
      env: RunContext.argvValue(argv, "--env", "-e"),
      envFile: RunContext.argvValue(argv, "--env-file"),
      server: serverFlag,
    });
    const cwd = resolveCwd(typed);
    try {
      const source = await RunContext.sourceOf(reading, cwd, serverFlag);

      return new RunContext(
        {
          ...meta,
          cwd,
          serverFlag,
          source,
        },
        scope,
        false,
      );
    } catch {
      return new RunContext(
        {
          ...meta,
          cwd,
          serverFlag,
        },
        scope,
        false,
      );
    }
  }

  /**
   * The context before any is settled, so an error thrown during flag parsing
   * still renders a complete envelope.
   *
   * @param version - The CLI's version.
   * @returns The context.
   */
  static fallback(version: string): GlobalOptions {
    return {
      cwd: resolveCwd(undefined),
      nonInteractive: false,
      dryRun: false,
      force: false,
      command: "(default)",
      cliVersion: version,
      source: "",
      verbose: false,
      debug: false,
      env: process.env,
      isTTY: RunContext.isTerminal(),
    };
  }

  /**
   * Whether a person is at the terminal on both ends: stdout and stdin.
   *
   * @returns Whether both are a terminal.
   */
  static isTerminal(): boolean {
    return Boolean(process.stdout.isTTY && process.stdin.isTTY);
  }

  /**
   * What `FORCE_COLOR` says about colour: on for any value but `0` and `false`
   * (in any case), off for those two, and nothing when it is unset or empty.
   *
   * @param env - The environment the run reads.
   * @returns True when colour is forced on, false when forced off, and
   * `undefined` when the variable says nothing.
   */
  static forcedColour(env: NodeJS.ProcessEnv): boolean | undefined {
    const value = (env[FORCE_COLOR.name] ?? "").toLowerCase();
    if (value === "") {
      return undefined;
    }

    return !["0", "false"].includes(value);
  }

  /**
   * The value an option has on the command line, as `--name value` or
   * `--name=value`, for a failure that came before oclif had parsed any.
   *
   * @param argv - The words the command was run with.
   * @param names - The spellings of the option.
   * @returns The value, if it was typed.
   */
  static argvValue(argv: readonly string[], ...names: string[]): string | undefined {
    for (const [index, word] of argv.entries()) {
      for (const name of names) {
        if (word === name) {
          return argv[index + 1];
        }
        if (word.startsWith(`${name}=`)) {
          return word.slice(name.length + 1);
        }
      }
    }

    return undefined;
  }

  /**
   * The server a run is about: the one the command's own `source` names, or
   * else what resolving `--server` makes of it.
   *
   * @param reading - What the command says of itself.
   * @param cwd - The directory the run addresses.
   * @param serverFlag - What `--server` was given, if it was.
   * @returns The server.
   */
  private static async sourceOf(
    reading: CommandFacts,
    cwd: string,
    serverFlag: string | undefined,
  ): Promise<string> {
    if (reading.source === undefined) {
      return reading.resolveServer(cwd, serverFlag);
    } else {
      return reading.source;
    }
  }
}
