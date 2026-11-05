import type { Command, Interfaces } from "@oclif/core";

import { EXIT_CODES, type ZitadelErrorCode } from "../errors";
import { BaseCommand, FLAG_VARIABLES } from "./base";
import { COMMAND_GROUPS, type CommandGroup, compareInGroup } from "./groups";
import type { FlagVariable } from "./types";

/**
 * The command surface as data, which the docs site's CLI reference renders a
 * page per command from (`apps/docs/lib/cli-reference.ts`). The reference
 * test writes it to `command-reference.json` from the COMMANDS table and fails
 * while the committed file is out of date.
 *
 * It reads the statics oclif's help reads, in the root help's order: the
 * groups as they print, and each group by {@link compareInGroup}. The flags
 * every command inherits from {@link BaseCommand} are listed once, as
 * `globalFlags`, with the environment variables that set what they set, and
 * an example keeps only what follows the bin, so the docs show the invocation
 * they teach.
 */

/** A flag as the help describes it. An absent field is the flag's default. */
export type FlagReference = {
  name: string;
  char?: string;
  description?: string;
  /** An `option` takes a value; a `boolean` does not. */
  type: "boolean" | "option";
  /** `--no-<name>` turns the boolean off. */
  allowNo?: true;
  required?: true;
  /** Can be given more than once. */
  multiple?: true;
  options?: string[];
  default?: boolean | number | string;
  min?: number;
  max?: number;
  /** The flags it cannot be combined with. */
  exclusive?: string[];
  /** The section the help lists it under, such as `REQUIRED FIELD`. */
  helpGroup?: string;
};

export type ArgReference = {
  name: string;
  description?: string;
  required?: true;
  options?: string[];
};

/** An example's command line, after the bin. */
export type ExampleReference = { command: string; description?: string };

export type CommandReference = {
  /** The command as typed after the bin: `auth-method sso enable`. */
  id: string;
  group: CommandGroup;
  description: string;
  aliases?: string[];
  /** oclif's `state`, such as `beta` or `deprecated`. */
  state?: string;
  args: ArgReference[];
  /** Takes more arguments than it names, as `api` takes its path parameters. */
  variadic?: true;
  flags: FlagReference[];
  examples: ExampleReference[];
};

export type CliReference = {
  bin: string;
  groups: CommandGroup[];
  globalFlags: FlagReference[];
  /** In the order of the global flags they stand in for. */
  env: FlagVariable[];
  /** The process exit code of each error `code` an envelope can carry. */
  exitCodes: Record<ZitadelErrorCode, number>;
  commands: CommandReference[];
};

/** A command class with the root-help statics {@link BaseCommand} declares. */
type ReferencedCommand = typeof Command & { group?: CommandGroup; groupOrder?: number };

/**
 * The `--json` oclif puts before the base flags of a command that sets
 * `enableJsonFlag` (`aggregateFlags` in `@oclif/core`, which it does not export).
 */
const JSON_FLAG: FlagReference = {
  name: "json",
  description: "Format output as json.",
  type: "boolean",
};

/** The reference of a COMMANDS table (`src/index.ts`) whose binary is `bin`. */
export function cliReference(
  commands: Readonly<Record<string, typeof Command>>,
  bin: string,
): CliReference {
  const entries = Object.entries(commands)
    .map(([id, command]) => ({ id, command: command as ReferencedCommand }))
    .filter(({ command }) => !command.hidden)
    .map(({ id, command }) => ({ id, command, group: groupOf(id, command) }))
    .sort(
      (a, b) =>
        COMMAND_GROUPS.indexOf(a.group) - COMMAND_GROUPS.indexOf(b.group) ||
        compareInGroup(
          { id: a.id, groupOrder: a.command.groupOrder },
          { id: b.id, groupOrder: b.command.groupOrder },
        ),
    );

  const flagOrder = Object.keys(BaseCommand.baseFlags);

  return {
    bin,
    groups: [...COMMAND_GROUPS],
    globalFlags: [JSON_FLAG, ...flagReferences(BaseCommand.baseFlags, (text) => text)],
    env: [...FLAG_VARIABLES].sort((a, b) => flagOrder.indexOf(a.flag) - flagOrder.indexOf(b.flag)),
    exitCodes: { ...EXIT_CODES },
    commands: entries.map(({ id, command, group }) =>
      commandReference(id.replaceAll(":", " "), command, group, bin),
    ),
  };
}

function groupOf(id: string, command: ReferencedCommand): CommandGroup {
  const { group } = command;
  if (group === undefined || !COMMAND_GROUPS.includes(group)) {
    throw new Error(`${id} declares no group of lib/oclif/groups.ts as its static group.`);
  }
  return group;
}

function commandReference(
  id: string,
  command: ReferencedCommand,
  group: CommandGroup,
  bin: string,
): CommandReference {
  // The global flags are listed once, for every command, so each must take
  // all of them.
  const base: Interfaces.FlagInput = command.baseFlags ?? {};
  const globalFlags = Object.entries(BaseCommand.baseFlags);
  if (!command.enableJsonFlag || globalFlags.some(([name, flag]) => base[name] !== flag)) {
    throw new Error(`${id} does not take BaseCommand's flags and --json, the global flags.`);
  }
  // Its own flags, then those its family adds to the base flags, such as the
  // `--schema` of every `auth-method` command.
  const own: Interfaces.FlagInput = command.flags ?? {};
  const family = Object.entries(base).filter(
    ([name]) => !(name in own) && !(name in BaseCommand.baseFlags),
  );
  const render = (text: string) => renderTemplates(text, id, bin);
  const description = [command.summary, command.description]
    .filter((text): text is string => typeof text === "string" && text.trim() !== "")
    .map(render)
    .join("\n\n");
  if (description === "") throw new Error(`${id} has neither a summary nor a description.`);
  const aliases = (command.aliases ?? []).map((alias) => alias.replaceAll(":", " "));

  return {
    id,
    group,
    description,
    ...(aliases.length > 0 && { aliases }),
    ...(command.state !== undefined && { state: command.state }),
    args: Object.entries(command.args ?? {})
      .filter(([, arg]) => !arg.hidden)
      .map(([name, arg]) => ({
        name,
        ...(arg.description !== undefined && { description: render(arg.description) }),
        ...(arg.required === true && { required: true as const }),
        ...(arg.options !== undefined && { options: arg.options.map(String) }),
      })),
    ...(command.strict === false && { variadic: true as const }),
    flags: flagReferences({ ...own, ...Object.fromEntries(family) }, render),
    examples: (command.examples ?? []).map((example) => exampleReference(example, render, id, bin)),
  };
}

function flagReferences(
  input: Interfaces.FlagInput,
  render: (text: string) => string,
): FlagReference[] {
  return Object.entries(input)
    .filter(([, flag]) => !flag.hidden)
    .map(([name, flag]) => flagReference(name, flag, render));
}

function flagReference(
  name: string,
  flag: Interfaces.Flag<unknown>,
  render: (text: string) => string,
): FlagReference {
  const text = flag.description ?? flag.summary;
  // Flags.integer keeps its bounds on the flag.
  const { min, max } = flag as { min?: unknown; max?: unknown };
  const value: unknown = flag.default;

  return {
    name,
    ...(flag.char !== undefined && { char: flag.char }),
    ...(text !== undefined && { description: render(text) }),
    type: flag.type,
    ...(flag.type === "boolean" && flag.allowNo && { allowNo: true as const }),
    ...(flag.required === true && { required: true as const }),
    ...(flag.type === "option" && flag.multiple === true && { multiple: true as const }),
    ...(flag.type === "option" && flag.options !== undefined && { options: [...flag.options] }),
    // A computed default is the command's to describe, and `false` is every
    // boolean's.
    ...((typeof value === "string" || typeof value === "number" || value === true) && {
      default: value,
    }),
    ...(typeof min === "number" && { min }),
    ...(typeof max === "number" && { max }),
    ...(flag.exclusive !== undefined &&
      flag.exclusive.length > 0 && { exclusive: [...flag.exclusive] }),
    ...(flag.helpGroup !== undefined && { helpGroup: flag.helpGroup }),
  };
}

function exampleReference(
  example: Command.Example,
  render: (text: string) => string,
  id: string,
  bin: string,
): ExampleReference {
  const { command, description } =
    typeof example === "string" ? { command: example, description: undefined } : example;
  const line = render(command);
  if (!line.startsWith(`${bin} `)) {
    throw new Error(`An example of ${id} does not start with <%= config.bin %>: ${command}`);
  }
  return {
    command: line.slice(bin.length + 1),
    ...(description !== undefined && { description: render(description) }),
  };
}

/** The templates oclif's help renders that the commands use: the bin and the id. */
function renderTemplates(text: string, id: string, bin: string): string {
  const rendered = text.replaceAll("<%= config.bin %>", bin).replaceAll("<%= command.id %>", id);
  if (rendered.includes("<%")) {
    throw new Error(
      `${id}: the reference renders <%= config.bin %> and <%= command.id %>: ${text}`,
    );
  }
  return rendered;
}
