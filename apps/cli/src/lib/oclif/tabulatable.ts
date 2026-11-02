import { type EscapeOptions, escapeControlCharacters } from "../api-client";
import { isObject } from "../json";
import type { BaseCommand } from "./base";

/** A class that can be extended, abstract or not, whatever arguments it takes. */
// biome-ignore lint/suspicious/noExplicitAny: the constructor of any command, which a mixin cannot name
type CommandClass<T extends BaseCommand> = abstract new (...args: any[]) => T;

/** What a command draws a table with: its own `tabulate`, for code that formats around the table. */
export type Tabulate = (columns: readonly string[], items: readonly unknown[]) => Promise<string>;

/** What {@link Tabulatable.tabulateList} needs to know about the list it draws. */
export type ListOptions = {
  plain: boolean;
  singular: string;
  plural?: string;
  empty: string;
  footer?: readonly string[];
};

/** Keeps a cell on one line: a line break or tab in it is escaped as well. */
const ONE_LINE: EscapeOptions = { keepLayout: false };

/**
 * One cell: a dot-path resolved through objects, rendered as text. Every view
 * reads its values here, so control characters in a value from a server are
 * escaped for all of them and none can drive the terminal.
 */
const readCell = (column: string, item: unknown, options?: EscapeOptions): string => {
  const value = column
    .split(".")
    .reduce<unknown>((current, key) => (isObject(current) ? current[key] : undefined), item);
  const text = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
  return escapeControlCharacters(text, options);
};

/**
 * Marks a command that prints a table, a list or a record, and gives it the one
 * way to do it. Only a command built on this has `this.tabulate`,
 * `this.tabulateList`, `this.tabulateRows` and `this.tabulateDetail`, so what
 * prints one is visible in the class it extends, and `@oclif/table` is
 * imported nowhere else.
 *
 * ```ts
 * export default class OriginList extends Tabulatable(EnvironmentCommand) {}
 * ```
 *
 * A table is for a person at a terminal, so under `--json` the two that draw
 * one return an empty string without loading anything: the table library draws
 * with `ink` and `react`, which take a few hundred milliseconds to load, and a
 * machine reading the envelope would pay for a rendering it throws away.
 */
export function Tabulatable<TBase extends CommandClass<BaseCommand>>(Base: TBase) {
  abstract class TabulatableCommand extends Base {
    /**
     * Whether a list is for a script: the `--plain` flag, or no terminal to
     * draw a table on. Every list command asks here, so none re-derives it.
     */
    protected isPlain(plainFlag?: boolean): boolean {
      return plainFlag === true || !process.stdout.isTTY;
    }

    /**
     * `items` as an aligned text table, one column per dot-path in `columns`,
     * headed by each path's last segment. Nested paths resolve through objects;
     * missing values render empty; non-strings render as JSON. Nothing under
     * `--json`.
     *
     * `@oclif/table` lays it out, so wide characters are measured by how they
     * are drawn and the columns after them stay aligned. The table keeps its
     * natural width at any terminal size: the library's way of fitting one
     * shares the width between columns in proportion and breaks inside a word,
     * which leaves an id or a path in pieces that cannot be read or copied, so
     * a row wider than the terminal is left to the terminal to wrap. The
     * library is imported here, when a table is drawn, and not at the top.
     */
    protected async tabulate(
      columns: readonly string[],
      items: readonly unknown[],
    ): Promise<string> {
      if (this.jsonEnabled()) {
        return "";
      }
      const { makeTable } = await import("@oclif/table");
      const table = makeTable({
        data: items.map((item) =>
          Object.fromEntries(columns.map((column) => [column, readCell(column, item, ONE_LINE)])),
        ),
        columns: columns.map((key) => ({ key, name: key.split(".").at(-1) ?? key })),
        borderStyle: "headers-only-with-underline",
        maxWidth: "none",
      });
      return table.replace(/\n+$/, "");
    }

    /**
     * The whole terminal rendering of a list, so no command re-derives the
     * plain/TTY/empty/footer logic (and so none forgets `--plain`): a pipe (or
     * `--plain`) gets tab-separated rows with no header and nothing when empty,
     * so `cut`/`awk`/`wc -l` work; a terminal gets the aligned table, a blank
     * line, a `${n} ${singular|plural}` count, and any `footer` lines. Pair it
     * with `listData()` for the JSON envelope. Nothing under `--json`.
     */
    protected async tabulateList(
      columns: readonly string[],
      rows: readonly unknown[],
      options: ListOptions,
    ): Promise<string> {
      if (this.jsonEnabled()) {
        return "";
      }
      if (options.plain) {
        return this.tabulateRows(columns, rows);
      }
      if (rows.length === 0) {
        return options.empty;
      }
      const count = `${rows.length} ${rows.length === 1 ? options.singular : (options.plural ?? `${options.singular}s`)}`;
      return [await this.tabulate(columns, rows), "", count, ...(options.footer ?? [])].join("\n");
    }

    /**
     * The machine form of a list: one record per line, fields separated by
     * tabs, no header and no padding, so `cut -f2` and `awk -F'\t'` work. This
     * is what a piped run emits — the aligned table is for a terminal, where
     * nothing is parsing it. Tabs and newlines inside a value would break the
     * record, so they are escaped rather than passed through.
     */
    protected tabulateRows(columns: readonly string[], items: readonly unknown[]): string {
      return items
        .map((item) =>
          columns
            .map((column) => readCell(column, item).replaceAll("\t", "\\t").replaceAll("\n", "\\n"))
            .join("\t"),
        )
        .join("\n");
    }

    /**
     * One record for a person: the heading first, then a labelled field per
     * line. Nested paths are labelled by their last segment, so
     * `metadata.status` reads as `status`. It is the terminal rendering of
     * `get`; a pipe (and `--json`) still receives the whole object, since a
     * script wants the record, not a view of it.
     */
    protected tabulateDetail(
      heading: string | undefined,
      fields: readonly string[],
      item: unknown,
    ): string {
      // Width is measured over the fields that survive, so an omitted one cannot
      // pad every other label out of alignment.
      const rows = fields
        .map((field) => [field.split(".").at(-1) ?? field, readCell(field, item)] as const)
        .filter(([, value]) => value !== "");
      const width = Math.max(0, ...rows.map(([label]) => label.length));
      const body = rows.map(([label, value]) => `${label.padEnd(width)}  ${value}`);
      return [...(heading ? [heading, ""] : []), ...body].join("\n");
    }
  }
  return TabulatableCommand;
}
