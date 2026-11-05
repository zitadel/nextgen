/**
 * Runs `edit` on `source` with LF line ends and no byte-order mark, and hands
 * the result back in the file's own: an edit that matches or splices text, or
 * indexes it by parser offsets, then works the same on a file saved on Windows.
 * A result `edit` left unchanged returns `source` exactly, so a transform stays
 * idempotent and the doctor still reads it as applied.
 */
export function withLfLineEnds(source: string, edit: (lf: string) => string): string {
  const lf = lfText(source);
  const next = edit(lf);
  if (next === lf) {
    return source;
  }
  const bom = source.startsWith("﻿") ? "﻿" : "";
  return bom + (source.includes("\r\n") ? next.replace(/\n/g, "\r\n") : next);
}

/** `source` with LF line ends and without a byte-order mark. */
export function lfText(source: string): string {
  return source.replace(/^﻿/, "").replace(/\r\n/g, "\n");
}
