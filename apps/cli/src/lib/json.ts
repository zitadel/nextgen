import { stringify } from "safe-stable-stringify";

/**
 * Serialise a value to pretty-printed JSON with object keys sorted at every
 * depth. Determinism is the point: managed files written by the CLI must be
 * byte-stable across runs so diffs stay clean and content hashes don't churn
 * when only key ordering would otherwise differ. Delegates the deterministic
 * sort to `safe-stable-stringify`, matching `JSON.stringify(value, null, 2)`
 * formatting. The `?? "null"` only applies to `undefined`/function inputs,
 * which the CLI never serialises.
 */
export function stableStringify(value: unknown): string {
  return stringify(value, null, 2) ?? "null";
}

/**
 * Apply a mutation to a JSON document while preserving the source's key
 * order, indentation style, and trailing newline. The counterpart of
 * {@link stableStringify} for files the CLI does *not* own (the user's
 * `package.json`): determinism there is the user's formatting, not sorted
 * keys — reformatting a file we merely merge into turns a one-line change
 * into a whole-file diff. `JSON.parse` preserves string-key insertion order
 * per spec, and mutating an existing key keeps its position.
 */
export function updateJsonPreservingOrder(
  source: string,
  path: string,
  mutate: (value: Record<string, unknown>) => void,
): string {
  const value = parseJsonObject(source, path);
  mutate(value);
  // JSON.stringify emits LF; re-join with the source's own line endings so a
  // CRLF document stays CRLF instead of getting a whole-file EOL rewrite.
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const body = JSON.stringify(value, null, detectIndent(source)).split("\n").join(eol);
  return source.endsWith("\n") ? `${body}${eol}` : body;
}

/**
 * Infers the indentation unit of a JSON document: the whitespace prefix of
 * its first indented line, a compact document stays compact, and anything
 * unrecognizable falls back to two spaces.
 */
function detectIndent(source: string): string | number {
  const match = source.match(/\n([ \t]+)\S/);
  if (match?.[1]) {
    return match[1];
  }
  return source.trimEnd().includes("\n") ? 2 : 0;
}

/**
 * Parse `contents` as JSON and assert the root is a plain object (not an
 * array or scalar). The CLI's config and secret files are always objects, so
 * this guards callers from the `JSON.parse` return type of `any` and produces
 * a `path`-qualified error message pointing at the offending file.
 */
export function parseJsonObject(contents: string, path: string): Record<string, unknown> {
  const value = JSON.parse(contents) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must contain a JSON object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Narrows an unknown value to a plain (non-array, non-null) object. Shared by
 * the commands and the file-writer that walk parsed JSON, so the predicate
 * isn't reimplemented per call site.
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
