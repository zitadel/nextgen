import { Flags } from "@oclif/core";

import { type EscapeOptions, escapeControlCharacters } from "@/lib/terminal-text";
import { isObject } from "@/lib/json";
import { Cmd } from "@/lib/cmd";
import type { BaseCommand } from "./base";
import { listData } from "./envelope";
import { painted, rows } from "./rendering";
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
  flags: readonly string[];
  /** The envelope property the cursor is reported under, when the platform spells it differently. */
  cursorKey?: string;
};

/** Fields `--json` carries beside the canonical ones, which they may not replace. */
export type ListExtra = Record<string, unknown> & {
  items?: never;
  count?: never;
  next_page_token?: never;
};

/**
 * Everything one list command says about its list; `emitList` does the rest.
 * Every list passes every field, with the empty value when it has nothing to
 * say (`footer: []`, `page: null`, `extra: {}`), so the end of every list
 * command reads the same.
 *
 * A list either has the canonical `--json` shape, which `emitList` builds from
 * its items, page and extra fields, or fixes the whole `data` itself and has
 * no page; it cannot do both, so the cursor in the data and the cursor in the
 * footer cannot differ.
 */
export type ListView = {
  /** The dot-paths drawn as columns, in order. */
  columns: readonly string[];
  /** What is drawn: one record per row. */
  rows: readonly unknown[];
  singular: string;
  plural?: string;
  /** Said to a person when there is nothing to list; a pipe gets nothing. */
  empty: string;
  /** Lines under the count, for a person. */
  footer: readonly string[];
} & (
  | {
      /** What `--json` carries: the records the rows were made from. */
      items: readonly unknown[];
      page: ListPage | null;
      extra: ListExtra;
      data?: never;
    }
  | {
      /** The whole `--json` data, for a shape fixed before the canonical one. */
      data: unknown;
      items?: never;
      page: null;
      extra: Record<string, never>;
    }
);

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
        // The library styles a header bold blue from its own reading of the
        // environment, and spreads what it is given over that, so turning the
        // style off means naming both. The run has already settled the
        // question, and a `--no-color` run whose table arrived coloured anyway
        // would be the answer going unheard.
        headerOptions: this.isColored
          ? { bold: true, color: "blue" }
          : { bold: false, color: undefined },
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
      // A list is for a script when `--plain` asks, or when nothing is on
      // screen to draw a table on.
      const plain = flags.plain === true || !this.isOnScreen;
      // The cursor is opaque text from the server: `Cmd.option` quotes it so
      // whitespace or shell metacharacters cannot run from a copied command,
      // and it is spelled out so what drives a terminal cannot either. The
      // data keeps the cursor as it came, so paging with it still works.
      const token = view.page?.token || null;
      const shown = token === null ? null : escapeControlCharacters(token);
      const more =
        shown === null ? [] : [`More available: ${Cmd.option("--page-token", shown)} (or --all)`];
      // A paged list asks for its follow-up command whether or not there is a
      // next page, so a command that cannot suggest one fails on its first run
      // and not on the first result that spans two pages.
      const followUp =
        view.page === null
          ? undefined
          : this.suggestFollowUp(
              [
                view.page.command,
                ...view.page.flags,
                // The raw cursor: this command reaches the envelope, where a
                // script reads it to page, and `renderNextSteps` spells it out
                // for the copy a person sees.
                Cmd.option("--page-token", token ?? ""),
                "--json",
              ].join(" "),
            );
      const nextCommand = token === null ? undefined : followUp;
      return {
        status: "ok",
        data: view.items === undefined ? view.data : this.canonicalData(view, token),
        ...(nextCommand === undefined ? {} : { next: { commands: [nextCommand] } }),
        // Plain records are what a script reads, so they keep stdout to
        // themselves; the aligned table is painted. Either way every fragment
        // the rendering is composed of was spelled out where it was read.
        pretty: (plain ? rows : painted)(await this.renderList(plain, view, more)),
      };
    }

    /** The canonical `--json` data of a list: `items`, `count`, its cursor and its extra fields. */
    private canonicalData(
      view: ListView & { items: readonly unknown[] },
      token: string | null,
    ): Record<string, unknown> {
      const canonical = listData(view.items, {
        nextPageToken: token,
        cursorKey: view.page?.cursorKey,
      });
      const replaced = Object.keys(view.extra).filter((key) => key in canonical);
      if (replaced.length > 0) {
        throw new Error(`a list's extra fields may not replace ${replaced.join(", ")}`);
      }
      return { ...canonical, ...view.extra };
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
      // A view's words carry what the server answered as readily as a cell
      // does — an id in the empty line, the origins a footer names — so they
      // are spelled out here, where the cells and the cursor already are.
      if (view.rows.length === 0) {
        return escapeControlCharacters(view.empty);
      }
      const plural = view.plural ?? `${view.singular}s`;
      const count = `${view.rows.length} ${view.rows.length === 1 ? view.singular : plural}`;
      return [
        await this.tabulate(view.columns, view.rows),
        "",
        count,
        ...view.footer.map((line) => escapeControlCharacters(line)),
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
      // The heading is a field of the record, so it is the server's text as
      // much as any cell is, and `readCell` spells out only the cells.
      const headed = heading === undefined ? [] : [escapeControlCharacters(heading), ""];
      return [...headed, ...body].join("\n");
    }
  }
  return TabulatableCommand;
}
