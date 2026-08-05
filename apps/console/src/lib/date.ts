/**
 * `2026-07-12T16:59:04Z` → `12 Jul 2026`, the `CREATED` value on a schema row.
 *
 * Not an `Intl` preset: `en-GB`'s `medium` style abbreviates differently and
 * the numeric styles drop the month name. Formatting the parts and joining them
 * keeps month names localised while matching what the design draws.
 *
 * Returns `undefined` for a missing or unparseable value so callers render
 * nothing rather than `Invalid Date`.
 */
export function formatDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;

  const parts = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";

  return `${part("day")} ${part("month")} ${part("year")}`;
}
