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

/**
 * `2026-10-02T14:52:00Z` → `Oct 2, 2026, 14:52`, or `2 Oct 2026, 14:52`, in
 * the viewer's locale and time zone; the same fallback as {@link formatDate}.
 * For a moment rather than a day: a deployment's time is what orders it
 * against the next one.
 */
export function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
