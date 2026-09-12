import { ZitadelError } from "../../errors";

/** The `--filter` / `--sort` flag grammar of query-backed lists. */

/** `field=operation:value`, or `field=value` for `equals`. */
export const parseFilter = (
  raw: string,
  fields: readonly string[],
  operations: readonly string[],
): Readonly<{ field: string; operation: string; value: string }> => {
  const [field, ...rest] = raw.split("=");
  if (!field || rest.length === 0) {
    throw new ZitadelError("E_VALIDATION", `Invalid --filter "${raw}"`, {
      hint: `Use field=operation:value, e.g. ${fields[0]}=${operations[0]}:<value>.`,
    });
  }
  const expression = rest.join("=");
  const [candidate = "", ...value] = expression.split(":");
  if (operations.includes(candidate) && value.length > 0) {
    return { field, operation: candidate, value: value.join(":") };
  }
  // Everything else is an `equals` whose value happens to contain a colon (a
  // schema URL, a timestamp). A near-miss of a real operation is a typo, not a
  // literal: silently filtering for the string `contians:active` would answer
  // a question nobody asked.
  const typo =
    value.length > 0 ? operations.find((operation) => within(candidate, operation, 2)) : undefined;
  if (typo) {
    throw new ZitadelError("E_VALIDATION", `Unknown filter operation "${candidate}"`, {
      hint: `Did you mean ${typo}? For a literal value containing a colon, say so explicitly: ${field}=equals:${expression}.`,
      details: { operation: candidate, suggestion: typo, operations: [...operations] },
    });
  }
  return { field, operation: "equals", value: expression };
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
  return { field, direction };
};

/** Whether two words are within `max` single-character edits of each other. */
const within = (a: string, b: string, max: number): boolean => {
  if (a === b || Math.abs(a.length - b.length) > max) {
    return a === b;
  }
  let previous = [...Array.from({ length: b.length + 1 }, (_, i) => i)];
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
