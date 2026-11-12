import type { Interfaces } from "@oclif/core";

import { Cmd } from "@/lib/cmd";
import { type ByName, type Named, named } from "@/lib/names";
import { newestCliCommand, optionArgs, publicCliCommand } from "@/lib/public-cli";

/**
 * A command the CLI suggests running next — a `next.commands` entry on a
 * result, a `nextCommands` entry on an error, the `retry` of an input question
 * — and how the compiler holds each one to the command it names.
 *
 * A suggestion is never written as a string. It is an object naming its target
 * by id, with the target's own arguments and flags as values:
 *
 * ```ts
 * this.suggest({ id: "variable:get", args: { name: "FOO" }, flags: { json: true } });
 * ```
 *
 * The id is checked against {@link NextTable}, and the rest against what that
 * command declares: a required argument
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
 * The commands a run can suggest, by id. `src/index.ts` derives it once from
 * the command table it hands oclif (`WORKFLOW_COMMANDS` and the resource
 * registry), so there is nothing to keep in step with the commands. It is an
 * interface so that module can extend it without this one importing a command.
 */
// biome-ignore lint/suspicious/noEmptyInterface: `src/index.ts` extends it with the command table
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
      ? [
          | Absent<Key & string>
          // Given, and given on: a switch that is off does not satisfy it.
          | { readonly [Name in Needed as Named<Name>]: Exclude<Renderable, false> },
        ]
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

/** A suggestion of `Id`: the id, and the target's own arguments and flags. */
export type NextOf<Id extends SuggestionId> = Readonly<{ id: Id }> & SuggestInput<Id>;

/**
 * A suggestion of `Id` as a parameter checks it: `Id` is read from the object's
 * own `id`, and resolved against the command table only once a call asks for
 * it, so naming a suggestion in a signature costs the command classes nothing.
 */
export type Checked<Id extends string> = Id extends SuggestionId
  ? NextOf<Id>
  : Readonly<{ id: `${Id} is not a command` }>;

/**
 * A suggestion the compiler checks: one member per command, told apart by its
 * `id`, so an object naming a command that does not exist, or giving it what
 * it does not take, does not compile.
 */
export type Next = { [Id in SuggestionId]: NextOf<Id> }[SuggestionId];

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

/** A suggestion once its id is no longer known to the compiler. */
export type LooseNext = LooseInput & Readonly<{ id: string }>;

declare const runtimeChecked: unique symbol;

/**
 * A suggestion of a generated resource command whose id is only known at run
 * time (`${topic}:list` in the generic resource layer), which the renderer
 * checks instead of the compiler. Only {@link resourceSuggestion} makes one.
 */
export type RuntimeNext = LooseNext & { readonly [runtimeChecked]: true };

/**
 * A suggestion checked where it is written and rendered later, by the run
 * that reports it. Code that raises a failure below a command, where no run is
 * at hand, names its follow-ups as these; the command's failure handler
 * renders each with the run's own `--cwd`, `--env`, `--env-file` and
 * `--server`, so a refusal raised deep in a library is aimed at the same
 * project as one raised by the command.
 */
export type Suggestion = Next | RuntimeNext;

/** A follow-up as an error carries it: rendered already, or for the run to render. */
export type Suggested = SuggestedCommand | Suggestion;

/**
 * Renders a follow-up for the run it is handed by: `BaseCommand.suggest` as a
 * value, for a helper outside the command that names what to run next.
 */
export interface Suggest {
  <const Id extends string>(next: Checked<Id>): SuggestedCommand;
  (next: Suggested): SuggestedCommand;
}

/** {@link Suggest} as the words after the CLI, for a result that reports argument lists. */
export type SuggestWords = <const Id extends string>(next: Checked<Id>) => string[];

/** The running command again, with what changes checked against it. */
export type Again = <const Id extends SuggestionId>(
  id: Id,
  change: Readonly<{
    without?: readonly SuggestFlagName<Id>[];
    with?: Partial<SuggestFlags<Id>>;
  }>,
) => Promise<SuggestedCommand>;

/**
 * A suggestion of a generated resource command (`users:get`, `release:list`)
 * whose id is only known at run time, so the compiler cannot check it against a
 * command. The flags and arguments are checked when the run renders it instead:
 * the renderer throws on one the target does not declare, and on an id that is
 * no command.
 *
 * @param topic - The resource's topic, as oclif names it (`users`).
 * @param verb - The operation on it, under the verb its command is named by.
 * @param input - The target's arguments and flags, by the names code reads them.
 * @returns The suggestion, for the run that reports it to render.
 */
export function resourceSuggestion(
  topic: string,
  verb: "list" | "get" | "create" | "update" | "delete" | "revoke" | "deactivate",
  input: LooseInput = {},
): RuntimeNext {
  return { ...input, id: `${topic}:${verb}` } as RuntimeNext;
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
    const key = isSuggestion(next) ? canonical(next) : next;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * Renders suggestions against the commands `commands` loaded, with `scope` put
 * back on each and the CLI named as `cliVersion` runs it: the one way a
 * suggestion is rendered, whether by a run (`BaseCommand.suggest`), a hook or
 * a help class.
 *
 * @param commands - Where each target's declaration is found: oclif's config.
 * @param scope - What every suggestion is aimed at.
 * @param cliVersion - The release of the CLI the commands run.
 * @returns The renderer.
 */
export function suggesterFor(
  commands: Readonly<{ findCommand: (id: string) => Declaring | undefined }>,
  scope: Scope,
  cliVersion: string,
): Suggest {
  return (next: Suggested | LooseNext) => {
    if (typeof next === "string") {
      return next;
    }

    return renderSuggestion(
      next,
      declaredOf(next.id, commands.findCommand(next.id)),
      scope,
      cliVersion,
    );
  };
}

/**
 * A value as JSON with every object's keys sorted, so two suggestions written
 * with their properties in a different order read as the same.
 *
 * @param value - The value.
 * @returns Its canonical JSON.
 */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (typeof inner !== "object" || inner === null || Array.isArray(inner)) {
      return inner;
    }

    return Object.fromEntries(
      Object.entries(inner).sort(([one], [other]) => {
        return one.localeCompare(other);
      }),
    );
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

/**
 * The message a suggested `deploy` carries for the reader to fill in: a
 * non-interactive `deploy` with no message to fall back on refuses to run
 * without one.
 */
export const WHAT_CHANGED = "<what changed>";

/**
 * What the renderer needs to know of a suggestion's target, read from the
 * command oclif loaded rather than from its class, so rendering imports no
 * command.
 */
export type Declared = Readonly<{
  /**
   * Its flags by CLI spelling: whether each is a switch and takes `--no-`, and
   * what it requires of the others.
   */
  flags: ReadonlyMap<
    string,
    Readonly<{
      type: "boolean" | "option";
      allowNo?: boolean;
      required?: boolean;
      exclusive?: readonly string[];
      dependsOn?: readonly string[];
    }>
  >;
  /** Its arguments by CLI spelling, in the order the command line takes them. */
  args: readonly string[];
  /** The arguments it cannot run without. */
  requiredArgs?: readonly string[];
}>;

/**
 * What a run puts back on the commands it suggests, as it was typed: the
 * directory it addressed and, for a run that resolved an environment, how it
 * chose it.
 */
export type Scope = Readonly<{
  cwd?: string;
  env?: string;
  envFile?: string;
  server?: string;
}>;

/**
 * The commands that must run on the newest release rather than this one:
 * `upgrade` run by an old CLI would not know what the new one writes.
 */
const NEWEST: ReadonlySet<string> = new Set(["upgrade"]);

/** `envFile` as `env-file`: a name as code reads it, spelled as the command line takes it. */
export function spelled(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => {
    return `-${letter.toLowerCase()}`;
  });
}

/** Each word a value stands for on the command line: one, or one per item of a list. */
function wordsOf(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }

  return (Array.isArray(value) ? value : [value]).map(String);
}

/**
 * The scope a target is given. A command that resolves an environment
 * (it declares `--env-file`) takes all of it; any other command takes only the
 * directory, since it chooses no environment and its `--server`, where it
 * takes one, means something of its own (`setup --server local`). A scope flag
 * the suggestion sets itself is left as the suggestion set it, and setting
 * either half of the environment selection replaces both.
 */
function carried(scope: Scope, target: Declared, given: Readonly<Record<string, unknown>>): Scope {
  const isSet = (name: string) => {
    return given[name] !== undefined;
  };
  if (!target.flags.has("env-file")) {
    return isSet("cwd") || scope.cwd === undefined ? {} : { cwd: scope.cwd };
  }
  const choosesEnvironment = isSet("env") || isSet("envFile");

  return {
    ...(choosesEnvironment || scope.envFile === undefined ? {} : { envFile: scope.envFile }),
    ...(choosesEnvironment || scope.env === undefined || scope.envFile !== undefined
      ? {}
      : { env: scope.env }),
    ...(isSet("server") || scope.server === undefined ? {} : { server: scope.server }),
    ...(isSet("cwd") || scope.cwd === undefined ? {} : { cwd: scope.cwd }),
  };
}

/**
 * Refuses a suggestion that leaves out what its target requires or combines
 * what it refuses together. The compiler refuses the same for every
 * suggestion it can see; this catches one built where the target is only known
 * at run time, such as a generated resource command.
 *
 * @param id - The target.
 * @param input - The suggestion's arguments and flags.
 * @param target - What the target declares.
 * @throws {Error} Naming the first thing that is wrong.
 */
function refuseBroken(id: string, input: LooseInput, target: Declared): void {
  const given = new Set(
    Object.entries(input.flags ?? {}).flatMap(([name, value]) => {
      return value === undefined || value === false ? [] : [spelled(name)];
    }),
  );
  for (const [name, flag] of target.flags) {
    if (flag.required === true && !given.has(name)) {
      throw new Error(`${id} requires --${name}`);
    }
    if (!given.has(name)) {
      continue;
    }
    const clash = flag.exclusive?.find((other) => {
      return given.has(other);
    });
    if (clash !== undefined) {
      throw new Error(`${id} refuses --${name} with --${clash}`);
    }
    const missing = flag.dependsOn?.find((other) => {
      return !given.has(other);
    });
    if (missing !== undefined) {
      throw new Error(`${id} takes --${name} only with --${missing}`);
    }
  }
  const missingArg = target.requiredArgs?.find((arg) => {
    return input.args?.[named(arg)] === undefined;
  });
  if (missingArg !== undefined) {
    throw new Error(`${id} requires its ${missingArg}`);
  }
}

/**
 * A suggestion as the words after the CLI: the id as its words, the arguments
 * in the order the target declares them, the flags given in the order they
 * were given, then the scope the target takes (`--env-file` or `--env`, then
 * `--server`, then `--cwd`, the least interesting to read last). A value that
 * starts with `-` is joined to its flag with `=`; arguments that read as flags
 * go last, after a `--`.
 *
 * A flag or argument the target does not declare throws, and so does one
 * that leaves out what the target requires or combines flags it refuses
 * together: the compiler rules those out for every suggestion it can see, so
 * reaching one is a defect in a suggestion built where the id is only known at
 * run time (a generated resource command).
 *
 * @param id - The target, as oclif names it (`variable:get`).
 * @param input - Its arguments and flags, by the names code reads them.
 * @param target - What the target declares.
 * @param scope - What the run puts back on it.
 * @returns The words, each as the shell should receive it.
 * @throws {Error} When the suggestion does not fit what the target declares.
 */
export function suggestionWords(
  id: string,
  input: LooseInput,
  target: Declared,
  scope: Scope,
): string[] {
  const given = input.flags ?? {};
  const options: string[] = [];
  for (const [name, value] of Object.entries(given)) {
    const flag = spelled(name);
    const declared = target.flags.get(flag);
    if (declared === undefined) {
      throw new Error(`${id} declares no --${flag}`);
    }
    if (value === undefined) {
      continue;
    }
    if (declared.type === "boolean") {
      if (value === true) {
        options.push(`--${flag}`);
      } else if (value === false && declared.allowNo === true) {
        options.push(`--no-${flag}`);
      }
      continue;
    }
    for (const word of wordsOf(value)) {
      options.push(...optionArgs(`--${flag}`, word));
    }
  }
  refuseBroken(id, input, target);
  const scoped = carried(scope, target, given);
  for (const [name, value] of Object.entries(scoped)) {
    if (value !== undefined && target.flags.has(spelled(name))) {
      options.push(...optionArgs(`--${spelled(name)}`, value));
    }
  }
  // A positional argument is read by where it stands, so one given after one
  // left out would be read as the one left out.
  const present = target.args.map((arg) => {
    return input.args?.[named(arg)] !== undefined;
  });
  const gap = present.indexOf(false);
  const after = gap === -1 ? -1 : present.indexOf(true, gap);
  if (after !== -1) {
    throw new Error(`${id} takes its ${target.args[after]} only after its ${target.args[gap]}`);
  }
  const positional = [
    ...target.args.flatMap((arg) => {
      return wordsOf(input.args?.[named(arg)]);
    }),
    ...(input.rest ?? []),
  ];
  const unknown = Object.keys(input.args ?? {}).filter((name) => {
    return !target.args.some((arg) => {
      return named(arg) === name;
    });
  });
  if (unknown.length > 0) {
    throw new Error(`${id} declares no argument ${unknown.join(", ")}`);
  }
  const words = id.split(":").filter((word) => {
    return word !== "";
  });
  const delimited = positional.some((word) => {
    return word.startsWith("-");
  });

  return delimited
    ? [...words, ...options, "--", ...positional]
    : [...words, ...positional, ...options];
}

/**
 * The words as the command a reader runs: each one quoted as a shell word where
 * it needs it (`Cmd.quote`), after the `npx @zitadel/cli@<version>` this
 * release is run as, or its dist-tag for a command that must run the newest
 * one.
 *
 * @param words - The words after the CLI, from {@link suggestionWords}.
 * @param cliVersion - The release of the CLI that is running.
 * @returns The command.
 */
export function commandOf(words: readonly string[], cliVersion: string): SuggestedCommand {
  const line = Cmd.of(words).toString();
  const isNewest = NEWEST.has(words[0] ?? "");

  return (
    isNewest ? newestCliCommand(line, cliVersion) : publicCliCommand(line, cliVersion)
  ) as SuggestedCommand;
}

/**
 * What a command declares, as oclif reads it: the command oclif loaded for an
 * id, or the running command's own class with its base flags merged in.
 */
export type Declaring = Readonly<{
  flags: Readonly<
    Record<
      string,
      Readonly<{
        type: "boolean" | "option";
        allowNo?: boolean;
        required?: boolean;
        exclusive?: readonly string[];
        dependsOn?: readonly string[];
      }>
    >
  >;
  args: Readonly<Record<string, Readonly<{ required?: boolean }>>>;
}>;

/**
 * What a command declares, as the renderer reads it.
 *
 * @param id - The command, as oclif names it.
 * @param loaded - The command oclif found for it, if any.
 * @returns Its flags and arguments.
 * @throws {Error} When `loaded` is missing, so `id` is no command this CLI has.
 */
export function declaredOf(id: string, loaded: Declaring | undefined): Declared {
  if (loaded === undefined) {
    throw new Error(`${id} is not a command`);
  }

  return {
    flags: new Map(
      Object.entries(loaded.flags).map(([name, flag]) => {
        return [
          name,
          {
            type: flag.type,
            ...(flag.type === "boolean" && flag.allowNo === true ? { allowNo: true } : {}),
            ...(flag.required === true ? { required: true } : {}),
            ...(flag.exclusive === undefined ? {} : { exclusive: flag.exclusive }),
            ...(flag.dependsOn === undefined ? {} : { dependsOn: flag.dependsOn }),
          },
        ];
      }),
    ),
    args: Object.keys(loaded.args),
    requiredArgs: Object.entries(loaded.args).flatMap(([name, arg]) => {
      return arg.required === true ? [name] : [];
    }),
  };
}

/**
 * A suggestion rendered for a run: its words with the run's scope, as the
 * command a reader runs.
 *
 * @param next - The suggestion.
 * @param target - What the command it names declares.
 * @param scope - What the run puts back on it.
 * @param cliVersion - The release of the CLI that is running.
 * @returns The command.
 */
export function renderSuggestion(
  next: LooseNext,
  target: Declared,
  scope: Scope,
  cliVersion: string,
): SuggestedCommand {
  return commandOf(suggestionWords(next.id, next, target, scope), cliVersion);
}
