import { refusalError } from "@/lib/oclif/refusal";
import { allows, type FieldPaths, observedPaths, suggestable } from "./paths";

function refuseMissing(chosen: readonly string[], paths: FieldPaths): void {
  const missing = chosen.filter((field) => !allows(paths, field));
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
    .map((field) => field.trim())
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
