import { escapeControlCharacters } from "../../api-client";
import { isObject } from "../../json";

/**
 * The machine form of a list: one record per line, fields separated by tabs,
 * no header and no padding, so `cut -f2` and `awk -F'\t'` work. This is what a
 * piped run emits — the aligned table is for a terminal, where nothing is
 * parsing it. Tabs and newlines inside a value would break the record, so they
 * are escaped rather than passed through.
 */
export const renderRows = (columns: readonly string[], items: readonly unknown[]): string =>
  items
    .map((item) =>
      columns
        .map((column) => readCell(column, item).replaceAll("\t", "\\t").replaceAll("\n", "\\n"))
        .join("\t"),
    )
    .join("\n");

/**
 * Render `items` as an aligned text table, one column per dot-path in
 * `columns`, headed by each path's last segment. Nested paths resolve
 * through objects; missing values render empty; non-strings render as JSON;
 * control characters in a value are escaped, so a value from a server cannot
 * drive the terminal.
 *
 * `@oclif/table` lays it out, so wide characters are measured by how they are
 * drawn and the columns after them stay aligned. The table keeps its natural
 * width at any terminal size: the library's way of fitting one shares the width
 * between columns in proportion and breaks inside a word, which leaves an id or
 * a path in pieces that cannot be read or copied, so a row wider than the
 * terminal is left to the terminal to wrap. The library draws with `ink` and
 * `react`, which take a few hundred milliseconds to load, so it is imported here
 * and not at the top, and a command prints a table through `Tabulatable`, which
 * skips it under `--json`.
 */
export const renderTable = async (
  columns: readonly string[],
  items: readonly unknown[],
): Promise<string> => {
  const { makeTable } = await import("@oclif/table");
  const table = makeTable({
    data: items.map((item) =>
      Object.fromEntries(
        columns.map((column) => [
          column,
          escapeControlCharacters(readCell(column, item), { keepLayout: false }),
        ]),
      ),
    ),
    columns: columns.map((key) => ({ key, name: key.split(".").at(-1) ?? key })),
    borderStyle: "headers-only-with-underline",
    maxWidth: "none",
  });
  return table.replace(/\n+$/, "");
};

/**
 * The whole terminal rendering of a list, so no command re-derives the
 * plain/TTY/empty/footer logic (and so none forgets `--plain`): a pipe (or
 * `--plain`) gets tab-separated rows with no header and nothing when empty, so
 * `cut`/`awk`/`wc -l` work; a terminal gets the aligned table, a blank line, a
 * `${n} ${singular|plural}` count, and any `footer` lines. Pair it with
 * `listData()` for the JSON envelope.
 */
export const renderList = async (
  columns: readonly string[],
  rows: readonly unknown[],
  opts: {
    plain: boolean;
    singular: string;
    plural?: string;
    empty: string;
    footer?: readonly string[];
  },
): Promise<string> => {
  if (opts.plain) {
    return renderRows(columns, rows);
  }
  if (rows.length === 0) {
    return opts.empty;
  }
  const count = `${rows.length} ${rows.length === 1 ? opts.singular : (opts.plural ?? `${opts.singular}s`)}`;
  return [await renderTable(columns, rows), "", count, ...(opts.footer ?? [])].join("\n");
};

/** One cell: a dot-path resolved through objects, rendered as text. */
const readCell = (column: string, item: unknown): string => {
  const value = column
    .split(".")
    .reduce<unknown>((current, key) => (isObject(current) ? current[key] : undefined), item);
  return value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
};

/**
 * One record for a person: the heading first, then a labelled field per line.
 * Nested paths are labelled by their last segment, so `metadata.status` reads
 * as `status`. It is the terminal rendering of `get`; a pipe (and `--json`)
 * still receives the whole object, since a script wants the record, not a view
 * of it.
 */
export const renderDetail = (
  heading: string | undefined,
  fields: readonly string[],
  item: unknown,
): string => {
  // Width is measured over the fields that survive, so an omitted one cannot
  // pad every other label out of alignment.
  const rows = fields
    .map((field) => [field.split(".").at(-1) ?? field, readCell(field, item)] as const)
    .filter(([, value]) => value !== "");
  const width = Math.max(0, ...rows.map(([label]) => label.length));
  const body = rows.map(([label, value]) => `${label.padEnd(width)}  ${value}`);
  return [...(heading ? [heading, ""] : []), ...body].join("\n");
};
