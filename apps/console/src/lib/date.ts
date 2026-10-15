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
  return format(value, DATE);
}

/**
 * `2026-04-28T15:32:00Z` → `28 Apr 2026, 15:32` in the viewer's locale and
 * time zone — {@link formatDate} with the time of day, and the same fallback.
 */
export function formatDateTime(value: string): string {
  return format(value, { ...DATE, hour: "2-digit", minute: "2-digit" });
}

const DATE: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };

function format(value: string, options: Intl.DateTimeFormatOptions): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, options);
}

/** A day: the window in which a moment reads as "how long ago". */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A moment within the last day as `6h ago` or `12m ago`, and anything older
 * as {@link formatDateTime}: a deployment made today is read against now, one
 * made last week against the calendar. The short units are the design's own
 * rather than the locale's (`6 hr. ago`); the calendar form stays localised.
 * `now` is a parameter so a test can pin it.
 */
export function formatRecent(value: string, now: Date = new Date()): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const elapsed = now.getTime() - parsed.getTime();
  if (elapsed < 0 || elapsed >= DAY_MS) return formatDateTime(value);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  return minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
}
