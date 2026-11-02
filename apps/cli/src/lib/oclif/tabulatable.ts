import type { BaseCommand } from "./base";
import { renderList, renderTable } from "./crud/table";

/** A class that can be extended, abstract or not, whatever arguments it takes. */
// biome-ignore lint/suspicious/noExplicitAny: the constructor of any command, which a mixin cannot name
type CommandClass<T extends BaseCommand> = abstract new (...args: any[]) => T;

/**
 * Marks a command that prints a table, and gives it the one way to do it. Only
 * a command built on this has `this.tabulate` and `this.tabulateList`, so what
 * prints a table is visible in the class it extends.
 *
 * ```ts
 * export default class OriginList extends Tabulatable(EnvironmentCommand) {}
 * ```
 *
 * A table is for a person at a terminal, so under `--json` both return an empty
 * string without drawing anything: the table library takes a few hundred
 * milliseconds to load, and a machine reading the envelope would pay for a
 * rendering it throws away.
 */
export function Tabulatable<TBase extends CommandClass<BaseCommand>>(Base: TBase) {
  abstract class TabulatableCommand extends Base {
    /** `items` as an aligned table, or nothing under `--json`; see {@link renderTable}. */
    protected async tabulate(
      columns: readonly string[],
      items: readonly unknown[],
    ): Promise<string> {
      return this.jsonEnabled() ? "" : renderTable(columns, items);
    }

    /** `rows` as the list a terminal or a pipe gets, or nothing under `--json`; see {@link renderList}. */
    protected async tabulateList(
      columns: readonly string[],
      rows: readonly unknown[],
      options: Parameters<typeof renderList>[2],
    ): Promise<string> {
      return this.jsonEnabled() ? "" : renderList(columns, rows, options);
    }
  }
  return TabulatableCommand;
}
