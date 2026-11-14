import type { Command } from "@oclif/core";

import { regularPlural } from "@/lib/plural";

/**
 * The id a `<noun>:<verb>` command also answers to, its noun in the plural:
 * `users:list` for `user:list`. A command of one word has none, since its word
 * is the command itself and a plural of it would run it: `previews` must never
 * deploy a preview.
 *
 * @param id - The command's id, its words joined by `:`.
 * @returns The plural spelling, or `undefined` for a command of one word.
 */
export function pluralAliasOf(id: string): string | undefined {
  const [noun = "", ...rest] = id.split(":");
  return rest.length === 0 ? undefined : [regularPlural(noun), ...rest].join(":");
}

/**
 * Makes every `<noun> <verb>` command of a table answer to the plural of its
 * noun as well, hidden: help, completion and the command list show the one
 * spelling a command is declared under, and a run through the other is that
 * command, under its own id.
 *
 * It is set on the table rather than on each command, so a command cannot be
 * added without it.
 *
 * @param commands - The command table, by id.
 * @param without - The nouns that have no plural to answer to.
 * @returns The same table, its commands answering to their plural.
 */
export function answeringToPlurals<Table extends Record<string, typeof Command>>(
  commands: Table,
  without: ReadonlySet<string>,
): Table {
  for (const [id, command] of Object.entries(commands)) {
    const alias = pluralAliasOf(id);
    if (alias !== undefined && !without.has(id.split(":")[0] ?? "")) {
      command.hiddenAliases = [alias];
    }
  }
  return commands;
}

/** What a command list holds of a command, as far as an alias goes. */
type Listed = Readonly<{ id: string; hiddenAliases?: readonly string[] }>;

/**
 * The command each hidden alias stands for, by alias id. oclif lists an alias
 * as a copy of its command under the alias's id, so a copy names itself among
 * its own aliases, and the command is the entry that does not.
 *
 * @param commands - Every entry of the loaded command list.
 * @returns The command's id for each alias id.
 */
export function aliasedCommands(commands: readonly Listed[]): ReadonlyMap<string, string> {
  return new Map(
    commands.flatMap((command) => {
      const aliases = command.hiddenAliases ?? [];
      return aliases.includes(command.id)
        ? []
        : aliases.map((alias): [string, string] => {
            return [alias, command.id];
          });
    }),
  );
}

/**
 * The noun each plural stands for, by the plural (`users` for `user`): the
 * first word of an alias, and of the command behind it.
 *
 * @param commands - Every entry of the loaded command list.
 * @returns The noun for each plural the commands answer to.
 */
export function aliasedNouns(commands: readonly Listed[]): ReadonlyMap<string, string> {
  return new Map(
    [...aliasedCommands(commands)].map(([alias, id]): [string, string] => {
      return [alias.split(":")[0] ?? "", id.split(":")[0] ?? ""];
    }),
  );
}
