import { Cmd } from "@/lib/cmd";
import { named } from "@/lib/names";
import { newestCliCommand, optionArgs, publicCliCommand } from "@/lib/public-cli";

import type { LooseInput, LooseNext, SuggestedCommand } from "./index";

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
