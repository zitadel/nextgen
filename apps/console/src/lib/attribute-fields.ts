import { formatDate, formatDateTime } from "./date";
import { field } from "./record";
import {
  type UserSchema,
  declaredProperty,
  resolveSchemaPath,
  schemaPropertyLabel,
} from "./schema";

/**
 * One row of an attributes Fields view, relative to the object it lists.
 *
 * - `value`: a scalar, formatted (`empty` for null, absent or "").
 * - `list`: an array of scalars, each formatted.
 * - `group`: an object listed inline, with its own rows.
 * - `drill`: an object one level deeper than the view lists inline; opening it
 *   makes it the listed object.
 */
export type AttributeRow =
  | { kind: "value"; path: string[]; label: string; value: string; empty: boolean }
  | { kind: "list"; path: string[]; label: string; items: string[] }
  | { kind: "group"; path: string[]; label: string; rows: AttributeRow[] }
  | { kind: "drill"; path: string[]; label: string; count: number };

/**
 * The rows of an attributes object: its scalars and lists as rows, each
 * object inline as a group of its own rows, and anything deeper as a row that
 * drills into it. One inline level keeps a nested `address` readable at a
 * glance without letting a deep document push everything else out of view.
 *
 * Labels and formats come from the schema node the object sits at, when there
 * is one: the property's `title` (else its key humanised), and `format: date`
 * or `date-time` for dates. A key the schema does not declare keeps its own
 * spelling. Keys run in the schema's order (sorted, as the forms sort them),
 * then the undeclared ones, sorted.
 */
export function attributeRows(
  attributes: Record<string, unknown>,
  schema: UserSchema | undefined,
): AttributeRow[] {
  return rowsAt(attributes, schema, [], 0);
}

function rowsAt(
  node: Record<string, unknown>,
  schema: UserSchema | undefined,
  base: string[],
  depth: 0 | 1,
): AttributeRow[] {
  const rows: AttributeRow[] = [];
  for (const key of orderedKeys(node, schema)) {
    const value = node[key];
    const property = declaredProperty(schema, key);
    const label = schemaPropertyLabel(key, property);
    const path = [...base, key];
    if (isRecord(value) && Object.keys(value).length > 0) {
      if (depth === 0) {
        rows.push({
          kind: "group",
          path,
          label,
          rows: rowsAt(value, schema && resolveSchemaPath(schema, [key]), path, 1),
        });
      } else {
        rows.push({ kind: "drill", path, label, count: Object.keys(value).length });
      }
    } else if (Array.isArray(value) && value.length > 0) {
      if (value.every(isScalar)) {
        const items = property && isRecord(property.items) ? property.items : undefined;
        rows.push({
          kind: "list",
          path,
          label,
          items: value.map((item) => formatScalar(item, items)),
        });
      } else {
        // Objects in a list have no one-line form; the JSON tab shows them.
        const count = `${value.length} ${value.length === 1 ? "item" : "items"}`;
        rows.push({ kind: "value", path, label, value: count, empty: false });
      }
    } else {
      // Left here: a scalar, or an object or list with nothing in it.
      const empty =
        value === null || value === undefined || value === "" || typeof value === "object";
      rows.push({
        kind: "value",
        path,
        label,
        value: empty ? "—" : formatScalar(value, property),
        empty,
      });
    }
  }
  return rows;
}

/** How many lines the rows take: each row, and each group's heading and rows. */
export function countRows(rows: AttributeRow[]): number {
  return rows.reduce((n, row) => n + 1 + (row.kind === "group" ? countRows(row.rows) : 0), 0);
}

/**
 * The first `cap` lines of the rows, a group cut short where the cap falls
 * inside it (its heading counts as a line).
 */
export function capRows(rows: AttributeRow[], cap: number): AttributeRow[] {
  const kept: AttributeRow[] = [];
  let left = cap;
  for (const row of rows) {
    if (left <= 0) break;
    if (row.kind === "group") {
      kept.push({ ...row, rows: capRows(row.rows, left - 1) });
      left -= 1 + Math.min(countRows(row.rows), left - 1);
    } else {
      kept.push(row);
      left -= 1;
    }
  }
  return kept;
}

/**
 * The value at a path inside the attributes, if it is an object to list, so a
 * drilled-in view can tell a stale path (the user changed underneath it) from
 * a real one.
 */
export function attributesAt(
  attributes: Record<string, unknown>,
  path: string[],
): Record<string, unknown> | undefined {
  let node: unknown = attributes;
  for (const key of path) {
    if (!isRecord(node) || !Object.hasOwn(node, key)) return undefined;
    node = node[key];
  }
  return isRecord(node) ? node : undefined;
}

function orderedKeys(node: Record<string, unknown>, schema: UserSchema | undefined): string[] {
  const keys = Object.keys(node);
  const declared = keys.filter((key) => declaredProperty(schema, key)).sort();
  const rest = keys.filter((key) => !declaredProperty(schema, key)).sort();
  return [...declared, ...rest];
}

/**
 * A scalar as a reader reads it: `Yes`/`No` for a boolean, the viewer's own
 * date format where the schema says a string is a date. Anything else as is:
 * a number keeps its digits, since desk numbers and ids are numbers too.
 */
function formatScalar(value: unknown, property: Record<string, unknown> | undefined): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") {
    const format = property ? field(property, "format") : undefined;
    // A bare `YYYY-MM-DD` parses as UTC midnight, the day before west of
    // UTC; a calendar date has no time zone, so it is read as local.
    if (format === "date") return formatDate(DAY.test(value) ? `${value}T00:00:00` : value);
    if (format === "date-time") return formatDateTime(value);
    return value;
  }
  if (value === null) return "—";
  return String(value);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isScalar(value: unknown): boolean {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}
