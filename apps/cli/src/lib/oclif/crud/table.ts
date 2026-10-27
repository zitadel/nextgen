import { isObject } from "../../json";
import { COLUMN_GAP, columnRow } from "../../ui/layout";

/**
 * What separates two cells. Taken from the layout rather than written here, so
 * a row this builds is a row the layout recognises as columns and leaves whole
 * instead of folding it like a sentence. A table draws a header and a rule
 * above its first row, so every row of one has a neighbour whose gap it lines
 * up with and the alignment speaks for itself; a record can be a single field,
 * so each of its rows is marked instead.
 */
const GAP = " ".repeat(COLUMN_GAP);

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
 * What a dot-path is called when it is shown to a person: its last segment,
 * spelled the way the wire spells a field. A document the API carries
 * verbatim can hold a camelCase property (`schema.objectType`), and a header
 * reading `objectType` beside `created_at` says the two came from different
 * contracts when they did not. The path itself is untouched, so `--fields`
 * and `--json` still name the field exactly as the API does.
 */
export const headerOf = (column: string): string =>
  (column.split(".").at(-1) ?? column).replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

/**
 * Render `items` as an aligned text table, one column per dot-path in
 * `columns`, headed by each path's last segment. Nested paths resolve
 * through objects; missing values render empty; non-strings render as JSON.
 */
export const renderTable = (columns: readonly string[], items: readonly unknown[]): string => {
  const headers = columns.map(headerOf);
  const rows = items.map((item) => columns.map((column) => readCell(column, item)));
  // Folded rather than spread into `Math.max`: a wide `--all` can return more
  // rows than the engine accepts as arguments in one call.
  const widths = rows.reduce<number[]>(
    (current, row) => current.map((width, i) => Math.max(width, row[i]?.length ?? 0)),
    headers.map((header) => header.length),
  );
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, i) => cell.padEnd(widths[i] ?? 0))
      .join(GAP)
      .trimEnd();
  return [line(headers), line(widths.map((width) => "-".repeat(width))), ...rows.map(line)].join(
    "\n",
  );
};

/** What a list calls the thing it holds, in the plural. */
const pluralOf = (opts: { singular: string; plural?: string }): string =>
  opts.plural ?? `${opts.singular}s`;

/**
 * How many a list found, as the line its footer is built from: `1 schema`,
 * `12 resources`. It is derived from the resource's own nouns rather than
 * written per command, so every list counts in the same words.
 */
export const renderCount = (count: number, opts: { singular: string; plural?: string }): string =>
  `${count} ${count === 1 ? opts.singular : pluralOf(opts)}`;

/**
 * What a list says when it found nothing. One sentence for every list,
 * derived from the same nouns as the count: a command that wrote its own
 * ("No deployments yet", "No variables on the project") told the reader the
 * same thing in a different voice and made two lists look like two tools.
 */
export const renderEmpty = (opts: { singular: string; plural?: string }): string =>
  `No ${pluralOf(opts)} found.`;

/**
 * The whole terminal rendering of a list, so no command re-derives the
 * plain/TTY/empty/footer logic (and so none forgets `--plain`): a pipe (or
 * `--plain`) gets tab-separated rows with no header and nothing when empty, so
 * `cut`/`awk`/`wc -l` work; a terminal gets the aligned table, a blank line, a
 * {@link renderCount} count, and any `footer` lines. An empty one gets
 * {@link renderEmpty}, and there is no way to override it: a list that words
 * "found nothing" for itself is the drift this derives away. Pair it with
 * `listData()` for the JSON envelope.
 */
export const renderList = (
  columns: readonly string[],
  rows: readonly unknown[],
  opts: {
    plain: boolean;
    singular: string;
    plural?: string;
    footer?: readonly string[];
  },
): string => {
  if (opts.plain) {
    return renderRows(columns, rows);
  }
  if (rows.length === 0) {
    return renderEmpty(opts);
  }
  return [
    renderTable(columns, rows),
    "",
    renderCount(rows.length, opts),
    ...(opts.footer ?? []),
  ].join("\n");
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
    .map((field) => [headerOf(field), readCell(field, item)] as const)
    .filter(([, value]) => value !== "");
  const width = Math.max(0, ...rows.map(([label]) => label.length));
  // Marked, because a record of one field is one line and has nothing to line
  // up with: without the mark the layout reads it as a sentence and folds the
  // label away from the value.
  const body = rows.map(([label, value]) => columnRow(`${label.padEnd(width)}${GAP}${value}`));
  return [...(heading ? [heading, ""] : []), ...body].join("\n");
};
