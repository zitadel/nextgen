import type { BoxAction } from "@/lib/box";
import { errorMessage, ZitadelError } from "@/lib/errors";
import { log } from "@/lib/log";
import { named } from "@/lib/names";
import {
  commandOf,
  type Declared,
  type Declaring,
  declaredOf,
  isSuggestion,
  type LooseNext,
  type Scope,
  type Suggest,
  type Suggested,
  type SuggestedCommand,
  suggestionWords,
} from "@/lib/suggestion";
import { command, dim, strong } from "@/lib/style";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { NEXT_LABEL } from "@/lib/ui/summary";

/**
 * What a command suggests doing next, and the one place it is shown.
 *
 * A command never writes its next steps into its data or prints them: it
 * hands them to `emit` as the result's `next`, and the base command puts them
 * in the envelope and prints every one of them at the end of the run. Nothing
 * here knows which CLI it serves; the command type is the caller's.
 */

/**
 * A result's next steps. `actions` is prose for whoever reads the result and
 * `commands` is what to run; the two are independent lists. A list left
 * `undefined` is left out of the envelope, while an empty one is emitted
 * empty, so a command decides which of the two its contract promises.
 */
export type NextSteps<C extends string = string> = {
  readonly actions?: readonly string[];
  readonly commands?: readonly C[];
};

/** A step as the ending draws it: a sentence and, when it asks for one, the command. */
export type EndingStep = BoxAction;

/**
 * The next steps as the steps an ending is made of, so a command states them
 * once, as the result's `next`, and the envelope and the ending cannot say
 * different things. Prose is a step of its own; the commands follow under the
 * heading every command uses.
 */
export function stepsOf(next: NextSteps | undefined): EndingStep[] {
  const commands = next?.commands ?? [];

  return [
    ...(next?.actions ?? []).map((text) => {
      return { text };
    }),
    ...(commands.length === 0
      ? []
      : [
          {
            text: NEXT_LABEL,
            command: commands.join("\n"),
          },
        ]),
  ];
}

declare const stepsShown: unique symbol;

/**
 * Proof that a command printed its next steps itself, inside output of its
 * own such as a summary box. Only the code that drew them makes one, right
 * after drawing them, so a result can skip the trailing block only by having
 * shown the steps.
 */
export type StepsShown = { readonly [stepsShown]: true };

/** Made right after a command printed its next steps itself; nothing else calls it. */
export function asStepsShown(): StepsShown {
  return {} as StepsShown;
}

/**
 * The steps as envelope keys: `next_actions` and `next_commands`, each one
 * present exactly when the command set that list.
 */
export function nextStepsData<C extends string>(
  next: NextSteps<C>,
): { next_actions?: string[]; next_commands?: C[] } {
  return {
    ...(next.actions === undefined ? {} : { next_actions: [...next.actions] }),
    ...(next.commands === undefined ? {} : { next_commands: [...next.commands] }),
  };
}

/**
 * The block a run ends with: the prose, then each command on a `$` line, or
 * `""` when there is nothing to do next.
 */
export function renderNextSteps(next: NextSteps): string {
  const actions = next.actions ?? [];
  const commands = next.commands ?? [];
  if (actions.length === 0 && commands.length === 0) {
    return "";
  }

  // The block is coloured, so it is printed as it came and cannot be spelled
  // out as a whole. A suggested command goes through the palette, which spells
  // out what it is given; an action is prose nothing colours, and it names
  // what the server answered — a cursor to page with, an id to act on — so it
  // is spelled out here.
  return [
    strong(NEXT_LABEL),
    ...actions.map((action) => {
      return `  ${escapeControlCharacters(action)}`;
    }),
    ...commands.map((suggested) => {
      return `  ${dim("$")} ${command(suggested)}`;
    }),
  ].join("\n");
}

/**
 * The `user:password@` of a URL, which a rebuilt command never prints:
 * everything in the authority up to its last `@`, since a password may hold one.
 */
const CREDENTIALS = /(\w+:\/\/)[^/?#\s]*@/g;

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

/** How a rerun changes the command line it rebuilds, by the names code reads them. */
export type Rerun = Readonly<{
  /** Flags to leave out. */
  without?: readonly string[];
  /** Flags to set ahead of the typed ones, as a `--force` retry reads. */
  with?: Readonly<Record<string, unknown>>;
  /** Flags to set after the typed ones, such as a next page's token. */
  after?: Readonly<Record<string, unknown>>;
  /** The arguments to name, where they are not the ones typed. */
  arguments?: readonly string[];
}>;

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
      if (typeof next === "string") {
        return next;
      }

      return this.remembered(
        suggestionWords(next.id, next, this.declared(next.id), scope),
        cliVersion,
      );
    };
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
   */
  rerun(
    id: string,
    target: Declared,
    raw: readonly ParsedToken[],
    change: Rerun = {},
  ): SuggestedCommand {
    const redact = (word: string) => {
      return word.replace(CREDENTIALS, "$1");
    };
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
