import { ZitadelError } from "../../errors";
import { allows, type FieldPaths, observedPaths, suggestable } from "./paths";

/**
 * Which fields a human rendering shows: the resource's own by default, or the
 * caller's `--fields`. A path the record's shape cannot carry is refused with
 * the paths it can, so a typo is a local error with the answer attached rather
 * than a column of blanks — and the verdict comes from the shape, so it does
 * not change with how many records a page happened to return.
 */
export const chosenColumns = (
  fields: unknown,
  fallback: readonly string[],
  items: readonly unknown[],
  shape?: FieldPaths,
): readonly string[] => {
  if (typeof fields !== "string") {
    return fallback;
  }
  const chosen = fields
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
  if (chosen.length === 0) {
    throw new ZitadelError("E_VALIDATION", "--fields needs at least one column", {
      hint: `Comma-separated dot-paths, e.g. --fields ${fallback.join(",")}.`,
    });
  }
  // The schema is authoritative; without one, fall back to the records in hand,
  // which can only judge when there are some.
  const paths = shape ?? (items.length > 0 ? observedPaths(items) : undefined);
  if (!paths) {
    return chosen;
  }
  const missing = chosen.filter((field) => !allows(paths, field));
  if (missing.length > 0) {
    const available = suggestable(paths);
    throw new ZitadelError(
      "E_VALIDATION",
      `--fields has no such ${missing.length === 1 ? "column" : "columns"}: ${missing.join(", ")}`,
      { hint: `Available: ${available.join(", ")}.`, details: { missing, available } },
    );
  }
  return chosen;
};
