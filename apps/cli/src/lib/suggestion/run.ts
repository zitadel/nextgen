import { errorMessage, ZitadelError } from "@/lib/errors";
import { log } from "@/lib/log";
import { named } from "@/lib/names";

import {
  commandOf,
  type Declared,
  type Declaring,
  declaredOf,
  type FlagNameOf,
  type FlagsOf,
  isSuggestion,
  type LooseNext,
  type Scope,
  type Suggest,
  type Suggested,
  type SuggestedCommand,
  spelled,
  suggestionWords,
  withoutCredentials,
} from ".";

/**
 * The suggestions one run makes: rendered with the run's scope, remembered
 * with their words, and the run itself rebuilt as it was typed.
 */

/**
 * Flags that say how a run answers, never what it does, so a rebuilt command
 * leaves them out: the person or agent following it answers its own way.
 */
const ANSWERING: readonly string[] = [
  "json",
  "nonInteractive",
  "color",
  "debug",
  "verbose",
  "telemetry",
];

/** What a {@link RunSuggestions} reads off the run it renders for. */
export type SuggestingRun = Readonly<{
  /** Finds what a command declares, by id: oclif's config. */
  findCommand: (id: string) => Declaring | undefined;
  /** The release the run's commands are named for. */
  cliVersion: () => string;
  /** What the run puts back on each command it suggests. */
  scope: () => Scope;
}>;

/** One token of a command line as oclif parsed it. */
export type ParsedToken = Readonly<
  { type: "arg"; input: string } | { type: "flag"; flag: string; input: string }
>;

/**
 * How a rerun changes the command line it rebuilds: the one shape
 * {@link RerunOf} and {@link Rerun} both are, told apart by how they name and
 * type the flags.
 *
 * @typeParam Name - How a flag to leave out is named.
 * @typeParam Values - The flags to set, by name, with their values.
 */
type RerunShape<Name extends string, Values> = Readonly<{
  /** Flags to leave out. */
  without?: readonly Name[];
  /** Flags to set ahead of the typed ones, as a `--force` retry reads. */
  with?: Values;
  /** Flags to set after the typed ones, such as a next page's token. */
  after?: Values;
  /** The arguments to name, where they are not the ones typed. */
  arguments?: readonly string[];
}>;

/**
 * How a rerun changes the command line it rebuilds, checked against `Defs`:
 * the flags the code asking for it relies on the command declaring, typed as
 * they parse. A rerun from code that does not know which command it runs in
 * (a mixin) names them, and the run refuses one its command does not declare.
 *
 * @typeParam Defs - The flags the rerun relies on, as a command declares them.
 */
export type RerunOf<Defs> = RerunShape<
  FlagNameOf<{ flags: Defs }>,
  Partial<FlagsOf<{ flags: Defs }>>
>;

/**
 * How a rerun changes the command line it rebuilds, once its flags are only
 * names: what {@link RerunOf} becomes after the compiler has checked it, and
 * what the run checks again against the command it rebuilds.
 */
export type Rerun = RerunShape<string, Readonly<Record<string, unknown>>>;

/**
 * The commands one run suggests next: rendered against what each target
 * declares, with the run's scope put back on, and remembered with their words
 * so a result can report both (`next_commands` and `next_args`). A command owns
 * one; `BaseCommand` only hands calls to it.
 */
export class RunSuggestions {
  private readonly run: SuggestingRun;

  /** The words of every command this run rendered, by the command. */
  private readonly words = new Map<SuggestedCommand, readonly string[]>();

  /**
   * @param run - What the suggestions are rendered for.
   */
  constructor(run: SuggestingRun) {
    this.run = run;
  }

  /**
   * Renders follow-ups aimed at `scope`, as `cliVersion` runs them. A follow-up
   * rendered already is returned as it is.
   *
   * @param scope - What every suggestion is aimed at.
   * @param cliVersion - The release the suggestions run as.
   * @returns The renderer.
   */
  aimedAt(scope: Scope, cliVersion: string = this.run.cliVersion()): Suggest {
    return (next: Suggested | LooseNext) => {
      return this.render(next, scope, cliVersion);
    };
  }

  /**
   * One follow-up aimed at `scope`, as `cliVersion` runs it; one rendered
   * already is returned as it is.
   *
   * @param next - The follow-up.
   * @param scope - What it is aimed at.
   * @param cliVersion - The release it runs as.
   * @returns The command.
   * @throws {Error} When it names no command this CLI loaded, or input its
   *   command does not take.
   */
  render(
    next: Suggested | LooseNext,
    scope: Scope,
    cliVersion: string = this.run.cliVersion(),
  ): SuggestedCommand {
    if (typeof next === "string") {
      return next;
    }

    return this.remembered(
      suggestionWords(next.id, next, this.declared(next.id), scope),
      cliVersion,
    );
  }

  /**
   * A command this run rendered, as the words after the CLI, unquoted.
   *
   * @param command - A command this run rendered.
   * @returns Its words.
   * @throws {Error} When this run did not render `command`.
   */
  argsOf(command: SuggestedCommand): readonly string[] {
    const words = this.words.get(command);
    if (words === undefined) {
      throw new Error(`${command} was not rendered by this run`);
    }

    return words;
  }

  /**
   * The running command again, rebuilt from its command line as oclif parsed
   * it rather than as typed. A flag that only says how the run answered
   * (`--json`, `--non-interactive`, `--no-color`, …) and the scope the renderer puts back on are
   * left out, and a URL's credentials never reach the command. Arguments that
   * read as flags go last, after a `--`.
   *
   * @param id - The running command, as oclif names it.
   * @param target - What the running command declares, read off its class.
   * @param raw - Its command line, as oclif parsed it.
   * @param change - What the rerun changes.
   * @returns The command.
   * @throws {Error} When the change leaves out, or sets, a flag the command
   *   does not declare.
   */
  rerun(
    id: string,
    target: Declared,
    raw: readonly ParsedToken[],
    change: Rerun = {},
  ): SuggestedCommand {
    const undeclared = (change.without ?? []).filter((name) => {
      return !target.flags.has(spelled(name)) && !ANSWERING.includes(name);
    });
    if (undeclared.length > 0) {
      throw new Error(`${id} declares no --${undeclared.map(spelled).join(", --")} to leave out`);
    }
    const redact = withoutCredentials;
    const positional = (
      change.arguments ??
      raw.flatMap((token) => {
        return token.type === "arg" ? [token.input] : [];
      })
    ).map(redact);
    // The scope goes back on through the renderer, so only what it would not
    // put back stays as typed: a command that chooses no environment keeps its
    // own `--server`.
    const rescoped = target.flags.has("env-file") ? ["cwd", "server", "env", "envFile"] : ["cwd"];
    const dropped = new Set([...rescoped, ...ANSWERING, ...(change.without ?? [])]);
    const typed: Record<string, unknown> = {};
    for (const token of raw) {
      if (token.type !== "flag" || dropped.has(named(token.flag))) {
        continue;
      }
      const name = named(token.flag);
      const definition = target.flags.get(token.flag);
      if (definition?.type === "boolean") {
        // Only a switch that takes `--no-` is turned off by it; a switch named
        // `no-open` is on when it is typed.
        typed[name] = !(definition.allowNo === true && token.input === `--no-${token.flag}`);
        continue;
      }
      const before = typed[name];
      const value = redact(token.input);
      typed[name] =
        before === undefined
          ? value
          : [...(Array.isArray(before) ? before : [String(before)]), value];
    }
    const args = Object.fromEntries(
      target.args.flatMap((arg, index) => {
        const value = positional[index];
        return value === undefined ? [] : [[named(arg), value]];
      }),
    );
    const kept = Object.entries(typed).filter(([name]) => {
      return change.with?.[name] === undefined && change.after?.[name] === undefined;
    });
    const words = suggestionWords(
      id,
      {
        args,
        // What the rerun adds leads, then what the run was given, then what
        // continues it.
        flags: { ...change.with, ...Object.fromEntries(kept), ...change.after },
        rest: positional.slice(target.args.length),
      },
      target,
      this.run.scope(),
    );

    return this.remembered(words, this.run.cliVersion());
  }

  /**
   * A failure with every follow-up rendered for this run. One that cannot be
   * rendered is a defect in the suggestion, not in the run: it is left out
   * rather than let the failure the person is being told about turn into a
   * crash of its own.
   *
   * @param error - The failure as it was raised.
   * @returns The same failure, its follow-ups rendered.
   */
  renderedFailure(error: ZitadelError): ZitadelError {
    if (error.nextCommands === undefined || !error.nextCommands.some(isSuggestion)) {
      return error;
    }
    const suggest = this.aimedAt(this.run.scope());

    return new ZitadelError(error.code, error.message, {
      hint: error.hint,
      nextCommands: error.nextCommands.flatMap((next) => {
        try {
          return [suggest(next)];
        } catch (cause) {
          log.debug(`Left out a follow-up that could not be rendered: ${errorMessage(cause)}`);
          return [];
        }
      }),
      details: error.details,
    });
  }

  /**
   * What the command `id` declares, read from the command oclif loaded.
   *
   * @param id - The command, as oclif names it.
   * @returns Its flags and arguments.
   * @throws {Error} When `id` is no command this CLI loaded.
   */
  private declared(id: string): Declared {
    return declaredOf(id, this.run.findCommand(id));
  }

  /**
   * The command `words` stand for, remembered with them for {@link argsOf}.
   *
   * @param words - The words after the CLI.
   * @param cliVersion - The release the command runs as.
   * @returns The command.
   */
  private remembered(words: readonly string[], cliVersion: string): SuggestedCommand {
    const command = commandOf(words, cliVersion);
    this.words.set(command, Object.freeze([...words]));

    return command;
  }
}

/**
 * The scope a command line typed, without what it left out: `--env-file`
 * outranks `--env`, which the two cannot be given together for anyway.
 *
 * @param typed - The flags as parsed, each a string when it was given.
 * @returns The scope.
 */
export function typedScopeOf(typed: Readonly<Record<keyof Scope, unknown>>): Scope {
  const text = (value: unknown): string | undefined => {
    return typeof value === "string" ? value : undefined;
  };
  const cwd = text(typed.cwd);
  const envFile = text(typed.envFile);
  const env = envFile === undefined ? text(typed.env) : undefined;
  const server = text(typed.server);

  return Object.freeze({
    ...(cwd === undefined ? {} : { cwd }),
    ...(envFile === undefined ? {} : { envFile }),
    ...(env === undefined ? {} : { env }),
    ...(server === undefined ? {} : { server }),
  });
}
