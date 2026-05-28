/**
 * Serialise a value to pretty-printed JSON with object keys sorted at every
 * depth. Determinism is the point: managed files written by the CLI must be
 * byte-stable across runs so diffs stay clean and content hashes don't churn
 * when only key ordering would otherwise differ.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value), null, 2);
}

/**
 * Recursively return a structural copy of `value` with every object's keys
 * sorted lexicographically; arrays keep their order, primitives pass through.
 * Extracted from {@link stableStringify} so it can be reused (or tested)
 * wherever a canonical key ordering is needed before hashing or comparison.
 */
export function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = sortValue((value as Record<string, unknown>)[key]);
  }
  return out;
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
