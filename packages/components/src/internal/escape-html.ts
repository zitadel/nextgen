/**
 * Escapes the five HTML-significant characters so a string is safe to
 * interpolate into either element text or a double-quoted attribute value.
 *
 * Used for the orchestrator-owned attribution markup, which is appended after
 * the Liquid output has already been sanitised — so it can't rely on the
 * DOMPurify pass and must escape its own (tenant-supplied) values.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
