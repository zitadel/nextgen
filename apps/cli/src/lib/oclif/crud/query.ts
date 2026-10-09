import { ZitadelError } from "../../errors";
import type { FilterField } from "./types";

/**
 * The `--filter` / `--sort` grammar every list shares.
 *
 * A field's own declaration decides what it accepts, so the grammar is the
 * same whether the request goes out as a structured query body or as flat
 * query parameters. Anything the endpoint cannot honour is refused here,
 * naming the field and what it does accept, rather than becoming a 400.
 */

export type ParsedFilter = Readonly<{ field: FilterField; operation: string; value: string }>;

/** `field=operation:value`, or `field=value` for `equals`. */
export const parseFilter = (raw: string, filters: readonly FilterField[]): ParsedFilter => {
  const names = filters.map((filter) => filter.field);
  const [name, ...rest] = raw.split("=");
  if (!name || rest.length === 0) {
    throw new ZitadelError("E_VALIDATION", `Invalid --filter "${raw}"`, {
      hint: `Use field=operation:value, e.g. ${names[0]}=${filters[0]?.operations[0]}:<value>.`,
    });
  }
  const field = filters.find((filter) => filter.field === name);
  if (!field) {
    const near = names.find((candidate) => within(name, candidate, 2));
    throw new ZitadelError("E_VALIDATION", `Unknown filter field "${name}"`, {
      hint: `${near ? `Did you mean ${near}? ` : ""}Filterable fields: ${names.join(", ")}.`,
      details: { field: name, ...(near ? { suggestion: near } : {}), fields: names },
    });
  }

  const expression = rest.join("=");
  const [candidate = "", ...rawValue] = expression.split(":");
  const operations = field.operations;
  if (operations.includes(candidate) && rawValue.length > 0) {
    return checked({ field, operation: candidate, value: rawValue.join(":") });
  }
  // Everything else is an `equals` whose value happens to contain a colon (a
  // schema URL, a timestamp). A near-miss of a real operation is a typo, not a
  // literal: silently filtering for the string `contians:active` would answer
  // a question nobody asked.
  if (rawValue.length > 0) {
    const typo = operations.find((operation) => within(candidate, operation, 2));
    if (typo) {
      throw new ZitadelError("E_VALIDATION", `Unknown filter operation "${candidate}"`, {
        hint: `Did you mean ${typo}? For a literal value containing a colon, say so explicitly: ${name}=equals:${expression}.`,
        details: { operation: candidate, suggestion: typo, operations: [...operations] },
      });
    }
    // A real operation the endpoint does not offer for this field is the
    // interesting case: the word is spelled right, so the caller believes it
    // works. Say which field is the limitation, not just that it failed.
    if (!operations.includes(candidate) && KNOWN_OPERATIONS.has(candidate)) {
      throw new ZitadelError(
        "E_VALIDATION",
        `Filter field "${name}" does not support the ${candidate} operation`,
        {
          hint: `${name} accepts: ${operations.join(", ")}.`,
          details: { field: name, operation: candidate, operations: [...operations] },
        },
      );
    }
  }
  if (!operations.includes("equals")) {
    throw new ZitadelError("E_VALIDATION", `Filter field "${name}" needs an explicit operation`, {
      hint: `${name} accepts: ${operations.join(", ")}.`,
      details: { field: name, operations: [...operations] },
    });
  }
  return checked({ field, operation: "equals", value: expression });
};

/**
 * Operation names the CLI recognises as operations at all, so a value that
 * merely looks like `something:else` is not mistaken for one.
 */
const KNOWN_OPERATIONS = new Set([
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "less_than",
  "less_than_or_equal",
  "greater_than",
  "greater_than_or_equal",
  "array_contains",
]);

/** Reject a value outside a field's closed set before any request is made. */
const checked = (parsed: ParsedFilter): ParsedFilter => {
  const { values } = parsed.field;
  if (values && !values.includes(parsed.value)) {
    throw new ZitadelError(
      "E_VALIDATION",
      `Invalid value "${parsed.value}" for filter field "${parsed.field.field}"`,
      {
        hint: `Accepted values: ${values.join(", ")}.`,
        details: { field: parsed.field.field, value: parsed.value, values: [...values] },
      },
    );
  }
  return parsed;
};

/** `field:direction`; direction defaults to `asc`. */
export const parseSort = (
  raw: string,
  fields: readonly string[],
): Readonly<{ field: string; direction: string }> => {
  // Exactly a field and a direction: a trailing segment means the caller meant
  // something the grammar cannot express, and silently sorting anyway hides it.
  const [field, direction = "asc", ...extra] = raw.split(":");
  if (!field || extra.length > 0) {
    throw new ZitadelError("E_VALIDATION", `Invalid --sort "${raw}"`, {
      hint: `Use field:direction, e.g. ${fields[0]}:desc.`,
    });
  }
  if (!fields.includes(field)) {
    const near = fields.find((candidate) => within(field, candidate, 2));
    throw new ZitadelError("E_VALIDATION", `Unknown sort field "${field}"`, {
      hint: `${near ? `Did you mean ${near}? ` : ""}Sortable fields: ${fields.join(", ")}.`,
      details: { field, ...(near ? { suggestion: near } : {}), fields: [...fields] },
    });
  }
  if (direction !== "asc" && direction !== "desc") {
    throw new ZitadelError("E_VALIDATION", `Invalid sort direction "${direction}"`, {
      hint: "Use asc or desc.",
    });
  }
  return { field, direction };
};

/** Whether two words are within `max` single-character edits of each other. */
const within = (a: string, b: string, max: number): boolean => {
  if (a === b || Math.abs(a.length - b.length) > max) {
    return a === b;
  }
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return (previous[b.length] ?? max + 1) <= max;
};
