/**
 * Drives one value through what a command declares, so a test exercises the
 * flag or argument itself rather than a validator exported beside it. A flag
 * or argument file exports only its definition; the rule it holds, and the
 * wording it refuses with, are reached from here.
 */
import { Command, Config } from "@oclif/core";

/**
 * The command a parse runs inside. oclif hands every `parse` the running
 * command, so a real one stands in here rather than an empty object; nothing
 * runs it.
 */
class ParsingCommand extends Command {
  /**
   * Never called: the command only carries the context a parse is handed.
   *
   * @returns Nothing, at once.
   */
  public run(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * What oclif hands a flag's `parse` as its context: the running command and
 * the token being parsed.
 */
type FlagContext = Command & {
  readonly token: {
    readonly type: "flag";
    readonly flag: string;
    readonly input: string;
  };
};

/**
 * What oclif hands an argument's `parse` as its context: the running command
 * and the token being parsed.
 */
type ArgContext = Command & {
  readonly token: {
    readonly type: "arg";
    readonly arg: string;
    readonly input: string;
  };
};

/**
 * A flag as a command declares it, built and ready to parse.
 *
 * oclif hands `parse` the declaration itself as its last argument, and that is
 * what {@link parseFlag} passes too. `parse` is a method signature so a table
 * of flags with different value types can share this one type: the compiler
 * then accepts each flag's own declaration type for that argument rather than
 * requiring one type that fits every flag in the table.
 */
type DeclaredFlag<T> = {
  parse?(input: string, context: FlagContext, declared: Named): Promise<T>;
};

/**
 * An argument as a command declares it, built and ready to parse, typed the
 * same way as {@link DeclaredFlag}.
 */
type DeclaredArg<T> = {
  parse?(input: string, context: ArgContext, declared: Named): Promise<T>;
};

/** The name oclif sets on a declaration before it hands it to `parse`. */
type Named = {
  readonly name: string;
};

/**
 * The command a parse is handed, a fresh one for each parse.
 *
 * @returns A command no test runs, carrying an unloaded configuration.
 */
function parsingCommand(): Command {
  return new ParsingCommand([], new Config({ root: process.cwd() }));
}

/**
 * The value a flag holds, or the refusal it raises. `name` is the flag as the
 * command line spells it, without `--`, which some refusals name.
 *
 * @param flag - The flag as the command declares it.
 * @param value - The text given for it on the command line.
 * @param name - The flag's name, which oclif sets on the declaration it hands `parse`.
 * @returns What the flag's `parse` resolves with.
 */
export async function parseFlag<T>(
  flag: DeclaredFlag<T>,
  value: string,
  name = "flag",
): Promise<T> {
  if (flag.parse === undefined) {
    throw new Error(`${name} declares no parse to drive`);
  }
  const context = Object.assign(parsingCommand(), {
    token: {
      type: "flag",
      flag: name,
      input: value,
    } as const,
  });
  return flag.parse(value, context, {
    ...flag,
    name,
  });
}

/**
 * The value an argument holds, or the refusal it raises. `name` is the
 * argument as the help names it, which some refusals name.
 *
 * @param arg - The argument as the command declares it.
 * @param value - The text given for it on the command line.
 * @param name - The argument's name, which oclif sets on the declaration it hands `parse`.
 * @returns What the argument's `parse` resolves with.
 */
export async function parseArg<T>(arg: DeclaredArg<T>, value: string, name = "name"): Promise<T> {
  if (arg.parse === undefined) {
    throw new Error(`${name} declares no parse to drive`);
  }
  const context = Object.assign(parsingCommand(), {
    token: {
      type: "arg",
      arg: name,
      input: value,
    } as const,
  });
  return arg.parse(value, context, {
    ...arg,
    name,
  });
}
