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
 * through objects; missing values render empty; non-strings render as JSON.
 */
export const renderTable = (columns: readonly string[], items: readonly unknown[]): string => {
  const headers = columns.map((column) => column.split(".").at(-1) ?? column);
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
      .join("  ")
      .trimEnd();
  return [line(headers), line(widths.map((width) => "-".repeat(width))), ...rows.map(line)].join(
    "\n",
  );
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
