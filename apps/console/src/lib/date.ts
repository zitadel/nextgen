/**
 * `2026-07-12T16:59:04Z` → `12 Jul 2026`, or `Jul 12, 2026`, or whatever the
 * viewer's locale puts that date in.
 *
 * Day, short month and year are requested; the order and separators are the
 * viewer's and are deliberately not pinned. Tests derive the expected string
 * the same way rather than hardcoding one locale's output.
 *
 * Falls back to the raw value rather than rendering `Invalid Date` if the
 * server sends something unparseable: showing what arrived beats showing
 * nothing, and beats showing a lie.
 */
export function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
