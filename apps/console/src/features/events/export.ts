import { eventsCsv, type LogEvent } from "./model";

/** The loaded events on the clipboard, as JSON: an array of what the API returned. */
export async function copyEvents(events: readonly LogEvent[]): Promise<void> {
  await navigator.clipboard.writeText(JSON.stringify(events, null, 2));
}

/**
 * The loaded events saved as a file: JSON, the events as the API returned
 * them, or CSV ({@link eventsCsv}). Named after the moment it was saved.
 */
export function downloadEvents(events: readonly LogEvent[], format: "json" | "csv"): void {
  const body = format === "json" ? JSON.stringify(events, null, 2) : eventsCsv(events);
  const type = format === "json" ? "application/json" : "text/csv";
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `events-${new Date().toISOString().replace(/[:.]/g, "-")}.${format}`;
  // In the document for the click: Firefox starts no download from a detached
  // link.
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Not at once: a browser that has not started reading the blob yet would
  // find it gone and save nothing.
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}

/** How long a saved file's blob stays readable after the click that saves it. */
const REVOKE_AFTER_MS = 10_000;
