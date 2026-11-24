import { isObject } from "@/lib/json";
import { refusalError } from "@/lib/oclif/refusal";

/**
 * The dot-paths a record can carry, read from the generated response schema
 * rather than from whatever a given page happened to return. Sampling the
 * response would make `--fields` valid or invalid depending on how many records
 * came back — the same arguments failing on a full page and passing on an empty
 * one — so the shape decides instead.
 *
 * An open record (a user's `attributes`, whose keys come from the project's
 * user schema and not from the API spec) cannot be enumerated, so it is
 * reported as a prefix: anything beneath it is accepted.
 */
export type FieldPaths = Readonly<{
  /** Exact paths, such as `id` or `metadata.status`. */
  known: ReadonlySet<string>;
  /** Prefixes below which any path is legal, such as `attributes`. */
  open: readonly string[];
}>;

/** Whether a path is legal for records of this shape. */
export const allows = (paths: FieldPaths, path: string): boolean =>
  paths.known.has(path) || paths.open.some((prefix) => path.startsWith(`${prefix}.`));

/** The paths worth showing a caller who named one that does not exist. */
export const suggestable = (paths: FieldPaths): readonly string[] =>
  [...paths.known, ...paths.open.map((prefix) => `${prefix}.<key>`)].sort();

/** Fallback when no schema is available: the paths these records actually carry. */
export const observedPaths = (items: readonly unknown[]): FieldPaths => {
  const known = new Set<string>();
  for (const item of items) {
    if (!isObject(item)) {
      continue;
    }
    for (const [key, value] of Object.entries(item)) {
      known.add(key);
      if (isObject(value)) {
        for (const nested of Object.keys(value)) {
          known.add(`${key}.${nested}`);
        }
      }
    }
  }
  return { known, open: [] };
};

function refuseMissing(chosen: readonly string[], paths: FieldPaths): void {
  const missing = [
    ...new Set(
      chosen.filter((field) => {
        return !allows(paths, field);
      }),
    ),
  ];
  if (missing.length === 0) {
    return;
  }
  const available = suggestable(paths);
  throw refusalError(
    {
      message: "No such {noun}: {missing}",
      hint: "Available: {available}.",
      details: {
        missing: "{missingList}",
        available: "{availableList}",
      },
    },
    {
      noun: new Intl.PluralRules("en").select(missing.length) === "one" ? "column" : "columns",
      missing: missing.join(", "),
      available: available.join(", "),
      missingList: missing,
      availableList: available,
    },
  );
}

/**
 * The columns `--fields` names, read as they are typed. An empty list is
 * refused, and so is a path the record's shape cannot carry when the shape is
 * known: the verdict then comes from the shape, so it does not change with
 * how many records a page happened to return.
 */
export const readColumns = (
  raw: string,
  fallback: readonly string[],
  shape?: FieldPaths,
): readonly string[] => {
  const chosen = raw
    .split(",")
    .map((field) => {
      return field.trim();
    })
    .filter(Boolean);
  if (chosen.length === 0) {
    throw refusalError(
      {
        message: "At least one column is needed",
        hint: "Comma-separated dot-paths, e.g. --fields {example}.",
      },
      {
        example: fallback.join(","),
      },
    );
  }
  if (shape) {
    refuseMissing(chosen, shape);
  }
  return chosen;
};

/**
 * Which fields a human rendering shows: the resource's own by default, or the
 * columns `--fields` chose. Without a schema to judge them by, the records in
 * hand do, which can only judge when there are some.
 */
export const chosenColumns = (
  chosen: readonly string[] | undefined,
  fallback: readonly string[],
  items: readonly unknown[],
  shape?: FieldPaths,
): readonly string[] => {
  if (chosen === undefined) {
    return fallback;
  }
  if (shape === undefined && items.length > 0) {
    refuseMissing(chosen, observedPaths(items));
  }
  return chosen;
};
