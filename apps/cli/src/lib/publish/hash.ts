/**
 * A content hash short enough for a line of the chain — a step of it, or the
 * line it closes on. `sha256:` and 64 hex digits is wider than one line, so
 * the digest is cut to the 12 characters that identify it in practice; the
 * full hash stays in the envelope, where something might match on it.
 */
export function abbreviate(hash: string): string {
  const separator = hash.indexOf(":");
  return `${separator < 0 ? "" : hash.slice(0, separator + 1)}${hash.slice(separator + 1, separator + 13)}`;
}
