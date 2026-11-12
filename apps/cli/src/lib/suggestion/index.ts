import type { Interfaces } from "@oclif/core";

import type { ByName, Named } from "@/lib/names";

import { commandOf, type Scope } from "./render";

/**
 * A command the CLI suggests running next — a `next.commands` entry on a
 * result, a `nextCommands` entry on an error, the `retry` of an input question
 * — and how the compiler holds each one to the command it names.
 *
 * A suggestion is never written as a string. It names its target by id and
 * gives the target's own arguments and flags as values:
 *
 * ```ts
 * this.suggest("variable:get", { args: { name: "FOO" }, flags: { json: true } });
 * ```
 *
 * The id is checked against {@link NextTable}, which every command adds itself
 * to, and the input against what that command declares: a required argument
 * or flag cannot be left out, a flag the target does not take cannot be
 * named, a value has the type the target parses it to, `exclusive` flags are
 * never both given and a `dependsOn` flag brings what it depends on (both
 * declared through `relatedFlags()` in `lib/oclif/flags.ts`, since oclif's own types
 * erase them). The run renders it (`BaseCommand.suggest`) and puts its own
 * `--cwd`, `--env`, `--env-file` and `--server` back on, so a suggestion cannot
 * aim at a different project than the run did.
 */

declare const suggestedCommand: unique symbol;

/**
 * A rendered suggestion: the command line a person or an agent runs. Only the
 * renderer and {@link shellCommand} make one, so a raw string does not
 * typecheck where a suggestion is expected.
 */
export type SuggestedCommand = string & { readonly [suggestedCommand]: true };

/**
 * The commands a run can suggest, by id. Each command adds its own entry
 * beside its class, so there is no table to keep in step with the commands:
 *
 * ```ts
 * declare module "@/lib/suggestion" {
 *   interface NextTable {
 *     "variable:get": typeof VariableGet;
 *   }
 * }
 * ```
 *
 * It is an interface, not `typeof COMMANDS`, because every command extends a
 * base whose `suggest` reads this table: a type computed from the command
 * table would be circular (TS2506), while an interface member resolves only
 * when a suggestion asks for it. `tests/types/suggestion.test-d.ts` fails when
 * a command in `COMMANDS` is missing here.
 */
// biome-ignore lint/suspicious/noEmptyInterface: each command merges its own entry in
export interface NextTable {}

/** The id of a command a run can suggest, such as `variable:get`. */
export type SuggestionId = keyof NextTable & string;

/**
 * Where `relatedFlags()` keeps the relations it was declared with. It is a symbol and
 * not enumerable, so oclif, which reads a command's flags by their names, never
 * sees it, while the type of a command's `flags` carries the relations for
 * {@link SuggestInput} to check against.
 */
export const RELATIONS: unique symbol = Symbol("relations");

/**
 * What one flag requires of the others: the `exclusive` flags it must not be
 * given with, the `dependsOn` flags it must be given with, and `required` when
 * it must be given at all. Names are the CLI spelling.
 */
export type FlagRelation<Name extends string> = Readonly<{
  exclusive?: readonly Name[];
  dependsOn?: readonly Name[];
  required?: true;
}>;

/** The relations of a set of flags, each keyed and naming flags of the same set. */
export type FlagRelations<Defs> = {
  readonly [Key in keyof Defs & string]?: FlagRelation<keyof Defs & string>;
};

declare const LOOSE_ARGS: unique symbol;

/**
 * The arguments of a command built at run time (a generated resource command),
 * whose names the compiler cannot know: a suggestion of one may name any, and
 * the renderer refuses one the command does not declare. A command that
 * declares no arguments of its own inherits oclif's open `args` and takes none.
 */
export type LooseArgs = Interfaces.ArgInput & { readonly [LOOSE_ARGS]: true };

/** A value as a command line carries it. */
type Renderable = string | number | boolean | readonly (string | number)[];

/**
 * The value a suggestion gives for a flag or argument that parses to `Value`.
 * A flag that parses to something a command line cannot carry (a duration, a
 * URL) is given as the text it is typed as.
 */
type Given<Value> = [NonNullable<Value>] extends [Renderable] ? NonNullable<Value> : string;

/** Flags that say how a run answers, never what a suggestion should do. */
type Answering = "color" | "debug" | "non-interactive" | "telemetry" | "verbose";

type Target<Id> = Id extends SuggestionId ? NextTable[Id] : never;

type OwnFlags<Class> = Class extends { flags: infer Flags } ? Flags : Record<never, never>;

type BaseFlags<Class> = Class extends { baseFlags: infer Flags } ? Flags : Record<never, never>;

type Defs<Class> = Omit<BaseFlags<Class> & OwnFlags<Class>, typeof RELATIONS>;

type Relations<Class> =
  OwnFlags<Class> extends { readonly [RELATIONS]?: infer Declared }
    ? unknown extends Declared
      ? Record<never, never>
      : NonNullable<Declared>
    : Record<never, never>;

type Values<Class> = Interfaces.InferredFlags<Defs<Class>>;

type FlagKey<Class> = Exclude<keyof Defs<Class> & string, Answering>;

/** The flags `relatedFlags()` declared `required`. */
type RequiredKey<Class> = {
  [Key in keyof Relations<Class>]: Relations<Class>[Key] extends { readonly required: true }
    ? Key
    : never;
}[keyof Relations<Class>] &
  string;

/**
 * Every guard at once, as one intersection. Each guard is a union of its own
 * (one side absent or the other), so it travels in a one-element tuple: a bare
 * union would be split into its members and intersected, which says
 * something else.
 */
type AllOf<Guards extends [unknown]> = [Guards] extends [never]
  ? unknown
  : (Guards extends unknown ? (value: Guards) => void : never) extends (value: infer Both) => void
    ? Both extends [infer Guard]
      ? Guard
      : never
    : never;

type Absent<Name extends string> = { readonly [Key in Name as Named<Key>]?: undefined };

/** For each `exclusive` relation, one of the two sides is left out. */
type Exclusions<Class> = AllOf<
  {
    [Key in keyof Relations<Class>]: Relations<Class>[Key] extends {
      readonly exclusive: readonly (infer Other extends string)[];
    }
      ? [Absent<Key & string> | Absent<Other>]
      : never;
  }[keyof Relations<Class>]
>;

/** For each `dependsOn` relation, the flag is left out or what it depends on is given. */
type Dependencies<Class> = AllOf<
  {
    [Key in keyof Relations<Class>]: Relations<Class>[Key] extends {
      readonly dependsOn: readonly (infer Needed extends string)[];
    }
      ? [Absent<Key & string> | { readonly [Name in Needed as Named<Name>]: unknown }]
      : never;
  }[keyof Relations<Class>]
>;

type FlagValues<Class> = {
  readonly [Key in Exclude<FlagKey<Class>, RequiredKey<Class>> as Named<Key>]?: Given<
    Values<Class>[Key & keyof Values<Class>]
  >;
} & {
  readonly [Key in RequiredKey<Class> as Named<Key>]: Given<
    Values<Class>[Key & keyof Values<Class>]
  >;
} & {
  /**
   * `--json`, which oclif adds to every command here (`enableJsonFlag`) rather
   * than declaring it among the flags.
   */
  readonly json?: boolean;
};

/** The flags a suggestion of `Id` may carry, by the names code reads them. */
export type SuggestFlags<Id> = FlagValues<Target<Id>> &
  Exclusions<Target<Id>> &
  Dependencies<Target<Id>>;

type ArgValues<Class> = Class extends { args: infer Args }
  ? Args extends Interfaces.ArgInput
    ? ByName<Interfaces.InferredArgs<Args>>
    : Record<never, never>
  : Record<never, never>;

type ArgsGiven<Class> = {
  readonly [Key in keyof ArgValues<Class> as undefined extends ArgValues<Class>[Key]
    ? never
    : Key]: Given<ArgValues<Class>[Key]>;
} & {
  readonly [Key in keyof ArgValues<Class> as undefined extends ArgValues<Class>[Key]
    ? Key
    : never]?: Given<ArgValues<Class>[Key]>;
};

type NoKeys<Shape> = keyof Shape extends never ? true : false;

type NeedsArgs<Class> =
  NoKeys<{
    [Key in keyof ArgsGiven<Class> as Record<never, never> extends Pick<ArgsGiven<Class>, Key>
      ? never
      : Key]: 1;
  }> extends true
    ? false
    : true;

type NeedsFlags<Class> = NoKeys<{ [Key in RequiredKey<Class>]: 1 }> extends true ? false : true;

type ArgsInput<Class> = Class extends { args: infer Args }
  ? string extends keyof Args
    ? Args extends { readonly [LOOSE_ARGS]: true }
      ? { readonly args?: Readonly<Record<string, string>> }
      : { readonly args?: never }
    : keyof Args extends never
      ? { readonly args?: never }
      : NeedsArgs<Class> extends true
        ? { readonly args: ArgsGiven<Class> }
        : { readonly args?: ArgsGiven<Class> }
  : { readonly args?: never };

type FlagsInput<Id> =
  NeedsFlags<Target<Id>> extends true
    ? { readonly flags: SuggestFlags<Id> }
    : { readonly flags?: SuggestFlags<Id> };

/**
 * What a suggestion of `Id` takes: its `args` and its `flags`, each required
 * exactly when the target requires one of them.
 */
export type SuggestInput<Id> = ArgsInput<Target<Id>> & FlagsInput<Id>;

/**
 * The rest of a suggestion's parameters: the input, left out when nothing in
 * it is required, and a sentence instead of a parameter when `Id` is no
 * command at all.
 */
export type SuggestRest<Id> = Id extends SuggestionId
  ? Record<never, never> extends SuggestInput<Id>
    ? [input?: SuggestInput<Id>]
    : [input: SuggestInput<Id>]
  : [unknownCommand: `${Id & string} is not a command`];

/** The flags of `Id` by the names code reads them, for a rerun's `without`. */
export type SuggestFlagName<Id> = Named<FlagKey<Target<Id>>>;

/** A suggestion's input once its id is no longer known to the compiler. */
export type LooseInput = Readonly<{
  args?: Readonly<Record<string, unknown>>;
  flags?: Readonly<Record<string, unknown>>;
  /**
   * Positional words beyond the arguments the target declares, for the rerun
   * of a command that takes any number of them (`api <operation> <param>…`).
   */
  rest?: readonly string[];
}>;

/**
 * Renders a suggestion for the run it is handed by: `BaseCommand.suggest` as a
 * value, for a helper outside the command that names what to run next.
 */
export type Suggest = <const Id extends string>(
  id: Id,
  ...rest: SuggestRest<Id>
) => SuggestedCommand;

/**
 * Renders a follow-up for the run it is handed by: `BaseCommand.rendered` as a
 * value, for a helper that holds deferred suggestions and must report them now.
 */
export type Render = (next: Suggested) => SuggestedCommand;

/** {@link Suggest} as the words after the CLI, for a result that reports argument lists. */
export type SuggestWords = <const Id extends string>(id: Id, ...rest: SuggestRest<Id>) => string[];

/** The running command again, with what changes checked against it. */
export type Again = <const Id extends SuggestionId>(
  id: Id,
  change: Readonly<{
    without?: readonly SuggestFlagName<Id>[];
    with?: Partial<SuggestFlags<Id>>;
  }>,
) => Promise<SuggestedCommand>;

declare const deferred: unique symbol;

/**
 * A suggestion checked where it is written and rendered later, by the run
 * that reports it. Code that raises a failure below a command, where no run is
 * at hand, names its follow-ups as these; the command's failure handler
 * renders each with the run's own `--cwd`, `--env`, `--env-file` and
 * `--server`, so a refusal raised deep in a library is aimed at the same
 * project as one raised by the command.
 */
export type Suggestion = Readonly<{ id: string; input: LooseInput }> & {
  readonly [deferred]: true;
};

/** A follow-up as an error carries it: rendered already, or for the run to render. */
export type Suggested = SuggestedCommand | Suggestion;

/**
 * A suggestion of `id`, checked against the command it names and rendered by
 * the run that reports it. See {@link Suggestion}.
 */
export function suggestion<const Id extends string>(id: Id, ...rest: SuggestRest<Id>): Suggestion {
  const input = (rest[0] ?? {}) as LooseInput;

  // The brand is a type alone: nothing at run time tells a suggestion apart
  // from another object with an id, which is why only this function makes one.
  return Object.freeze({ id, input }) as unknown as Suggestion;
}

/**
 * `next` aimed at a directory, an environment or a server of its own rather
 * than the one the run would put back on it: a `claim` pinned to the project
 * file setup wrote. Choosing either half of the environment replaces the run's
 * whole selection when it is rendered.
 *
 * @param next - The suggestion.
 * @param scope - Where it is aimed.
 * @returns The same suggestion, with those flags given.
 */
export function aimed(next: Suggestion, scope: Scope): Suggestion {
  const flags = Object.fromEntries(
    Object.entries(scope).filter(([, value]) => {
      return value !== undefined;
    }),
  );

  return Object.freeze({
    id: next.id,
    input: { ...next.input, flags: { ...next.input.flags, ...flags } },
  }) as unknown as Suggestion;
}

/**
 * A suggestion of a generated resource command (`users:get`, `release:list`)
 * whose id is only known at run time, so the compiler cannot check it against a
 * command. The flags and arguments are checked when the run renders it instead:
 * the renderer throws on one the target does not declare, and on an id that is
 * no command.
 *
 * @param topic - The resource's topic, as oclif names it (`users`).
 * @param verb - The operation on it.
 * @param input - The target's arguments and flags, by the names code reads them.
 * @returns The suggestion, for the run that reports it to render.
 */
export function resourceSuggestion(
  topic: string,
  verb: "list" | "get" | "create" | "update" | "delete",
  input: LooseInput = {},
): Suggestion {
  return Object.freeze({ id: `${topic}:${verb}`, input }) as unknown as Suggestion;
}

/** Whether `next` is still to be rendered. */
export function isSuggestion(next: Suggested): next is Suggestion {
  return typeof next !== "string";
}

/**
 * `suggested` with each follow-up only the first time it appears, in order: two
 * suggestions are the same when they name the same command with the same input.
 *
 * @param suggested - The follow-ups, perhaps with repeats.
 * @returns Them without the repeats.
 */
export function distinct(suggested: readonly Suggested[]): Suggested[] {
  const seen = new Set<string>();

  return suggested.filter((next) => {
    const key = isSuggestion(next) ? JSON.stringify([next.id, next.input]) : next;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/** A command that is not the CLI (`npm install …`, `rm …`), suggested as written. */
export function shellCommand(command: string): SuggestedCommand {
  return command as SuggestedCommand;
}

/**
 * A suggestion wrapped in shell around it: a pipe that feeds it a secret
 * (`printf '%s' "$SECRET" | `) or the `< value.txt` redirection that must
 * follow the selector. The command itself stays the one the renderer made.
 */
export function inShell(
  command: SuggestedCommand,
  shell: { before?: string; after?: string },
): SuggestedCommand {
  return `${shell.before ?? ""}${command}${shell.after ?? ""}` as SuggestedCommand;
}

/**
 * The help of `command`, which a refusal of the command line names: oclif's
 * own `--help`, which is no flag a command declares, so it is the one
 * suggestion not checked against a target.
 *
 * @param command - The command as it is typed (`variable get`), or `""` for the CLI.
 * @param cliVersion - The release of the CLI that is running.
 * @returns The command.
 */
export function helpCommand(command: string, cliVersion: string): SuggestedCommand {
  return commandOf(
    [
      ...command.split(" ").filter((word) => {
        return word !== "";
      }),
      "--help",
    ],
    cliVersion,
  );
}

export {
  commandOf,
  type Declared,
  declaredOf,
  renderSuggestion,
  type Scope,
  spelled,
  suggestionWords,
} from "./render";

/**
 * The message a suggested `deploy` carries for the reader to fill in: a
 * non-interactive `deploy` with no message to fall back on refuses to run
 * without one.
 */
export const WHAT_CHANGED = "<what changed>";
