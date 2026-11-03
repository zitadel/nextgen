import { Flags } from "@oclif/core";

import { type EscapeOptions, escapeControlCharacters } from "../api-client";
import { isObject } from "../json";
import { shellOption } from "../shell";
import type { BaseCommand } from "./base";
import { listData } from "./envelope";
import type { CommandResult, JsonEnvelope } from "./types";

/** A class that can be extended, abstract or not, whatever arguments it takes. */
// biome-ignore lint/suspicious/noExplicitAny: the constructor of any command, which a mixin cannot name
type CommandClass<T extends BaseCommand> = abstract new (...args: any[]) => T;

/** What a command draws a table with: its own `tabulate`, for code that formats around the table. */
export type Tabulate = (columns: readonly string[], items: readonly unknown[]) => Promise<string>;

/**
 * The `--plain` flag every list command declares, as the last entry of its
 * `flags`. One definition, so the help reads the same on all of them.
 */
export const plainFlag = Flags.boolean({
  description:
    "Tab-separated rows with no header, for piping. Implied when stdout is not a terminal.",
});

/**
 * What a list command hands {@link Tabulatable}'s `emitList`: its parsed flags,
 * which must carry `plain`, so a list that forgot to declare `--plain` does not
 * compile.
 */
export type ListFlags = { readonly plain: boolean | undefined };

/**
 * The next page of a paged list. A page token only works with the flags that
 * issued it, so `flags` repeats them: `emitList` appends the token and `--json`.
 */
export type ListPage = {
  token: string | null;
  command: string;
  flags?: readonly string[];
};

/** Everything one list command says about its list; `emitList` does the rest. */
export type ListView = {
  columns: readonly string[];
  rows: readonly unknown[];
  /** What `--json` carries, when it is not the drawn rows. */
  items?: readonly unknown[];
  singular: string;
  plural?: string;
  empty: string;
  footer?: readonly string[];
  page?: ListPage;
  /** Fields `--json` carries beside `items`, `count` and `next_page_token`. */
  extra?: Record<string, unknown>;
  /** The whole `--json` data, for a shape fixed before the canonical one. */
  data?: unknown;
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
 * Whether a list is for a script: the `--plain` flag, or no terminal to draw a
 * table on.
 */
const isPlain = (requested: boolean | undefined): boolean => {
  return requested === true || !process.stdout.isTTY;
};

/**
 * The machine form of a list: one record per line, fields separated by tabs,
 * no header and no padding, so `cut -f2` and `awk -F'\t'` work. This is what a
 * piped run emits — the aligned table is for a terminal, where nothing is
 * parsing it. Tabs and newlines inside a value would break the record, so they
 * are escaped rather than passed through.
 */
const tabulateRows = (columns: readonly string[], items: readonly unknown[]): string => {
  return items
    .map((item) => {
      return columns
        .map((column) => readCell(column, item).replaceAll("\t", "\\t").replaceAll("\n", "\\n"))
        .join("\t");
    })
    .join("\n");
};

/**
 * Marks a command that prints a table, a list or a record, and gives it the one
 * way to do it. Only a command built on this has `this.tabulate`,
 * `this.tabulateDetail` and `this.emitList`, so what prints one is visible in
 * the class it extends, and `@oclif/table` is imported nowhere else. A list
 * draws itself through `emitList` alone: how it is rendered, and whether it is
 * plain, is not a command's to decide.
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
     * The one way a list command ends: `return this.emitList(flags, {...})`.
     * It decides plain from the flags, builds the `--json` data, the table or
     * rows, the page footer and the next-page suggestion, and sends the next
     * steps to stderr for a pipe, so a list cannot forget any of them.
     */
    protected async emitList(flags: ListFlags, view: ListView): Promise<JsonEnvelope> {
      return this.emit(await this.listResult(flags, view));
    }

    /** {@link emitList}, for a caller that returns the result instead of emitting it. */
    protected async listResult(flags: ListFlags, view: ListView): Promise<CommandResult> {
      const plain = isPlain(flags.plain);
      // The cursor is opaque text from the server: `shellOption` quotes it so
      // whitespace or shell metacharacters cannot run from a copied command.
      const token = view.page?.token || null;
      const more =
        token === null ? [] : [`More available: ${shellOption("--page-token", token)} (or --all)`];
      const nextCommand =
        view.page === undefined || token === null
          ? undefined
          : this.suggestFollowUp(
              [
                view.page.command,
                ...(view.page.flags ?? []),
                shellOption("--page-token", token),
                "--json",
              ].join(" "),
            );
      return {
        status: "ok",
        data: view.data ?? {
          ...listData(view.items ?? view.rows, { nextPageToken: token }),
          ...view.extra,
        },
        ...(nextCommand === undefined ? {} : { next: { commands: [nextCommand] } }),
        machineReadable: plain,
        pretty: await this.renderList(plain, view, more),
      };
    }

    /**
     * The terminal rendering of a list: a pipe (or `--plain`) gets tab-separated
     * rows with no header and nothing when empty, so `cut`, `awk` and `wc -l`
     * work; a terminal gets the aligned table, a blank line, a
     * `${n} ${singular|plural}` count and the footer lines. Nothing under
     * `--json`.
     */
    private async renderList(
      plain: boolean,
      view: ListView,
      more: readonly string[],
    ): Promise<string> {
      if (this.jsonEnabled()) {
        return "";
      }
      if (plain) {
        return tabulateRows(view.columns, view.rows);
      }
      if (view.rows.length === 0) {
        return view.empty;
      }
      const plural = view.plural ?? `${view.singular}s`;
      const count = `${view.rows.length} ${view.rows.length === 1 ? view.singular : plural}`;
      return [
        await this.tabulate(view.columns, view.rows),
        "",
        count,
        ...(view.footer ?? []),
        ...more,
      ].join("\n");
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
