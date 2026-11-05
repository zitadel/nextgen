import { applyEdits, modify } from "jsonc-parser";
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
 * Replace (or insert) one top-level key's value in a JSON document by editing
 * its text, leaving every other byte of the source untouched. The
 * counterpart of {@link stableStringify} for files the CLI does *not* own
 * (the user's `package.json`): blank lines, inline nested objects, key
 * order, indentation style, line endings, and the trailing newline all
 * survive, because nothing outside the edited value is reserialized. The
 * value itself is rendered at the document's detected indent (a compact
 * document stays compact).
 *
 * Defensive by construction: the result is re-parsed and compared against
 * the expected mutation, so an edit that would corrupt the document throws
 * instead of writing it.
 */
export function setTopLevelJsonKey(
  source: string,
  path: string,
  key: string,
  value: unknown,
): string {
  const parsed = parseJsonObject(source, path);
  const indent = detectIndent(source);
  const compact = indent === 0;
  const edits = modify(source, [key], value, {
    // A compact document gets no formatting, so the value goes in on one line.
    formattingOptions: compact
      ? undefined
      : {
          insertSpaces: typeof indent === "number" || !indent.includes("\t"),
          tabSize: typeof indent === "number" ? indent : indent.includes("\t") ? 1 : indent.length,
          eol: source.includes("\r\n") ? "\r\n" : "\n",
        },
  }).map((edit) =>
    // The library writes a new member as `"key": value`; a compact document has no space there.
    compact ? { ...edit, content: edit.content.replace(/^(,?"(?:[^"\\]|\\.)*"): /, "$1:") } : edit,
  );
  const next = applyEdits(source, edits);

  const verification = parseJsonObject(next, path);
  const expected = { ...parsed, [key]: value };
  if (JSON.stringify(verification) !== JSON.stringify(expected)) {
    throw new Error(`refusing to write ${path}: the targeted JSON edit did not verify`);
  }
  return next;
}

/**
 * Infers the indentation unit of a JSON document: the whitespace prefix of
 * its first indented line, a compact document stays compact (`0`), and
 * anything unrecognizable falls back to two spaces.
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
 * Parses `text` as JSON for callers that treat "not JSON" as an ordinary answer
 * and have a fallback ready, such as a log line that may or may not be a JSON
 * record, or an optional file whose contents are only used when they parse.
 *
 * It never throws. The result is `unknown`, so the caller has to narrow it
 * (with {@link isObject}, for example) before using it. That also means the
 * text `null` parses to `null`, which is different from the `undefined` this
 * returns for text that is not JSON at all.
 *
 * Use {@link parseJsonObject} instead when invalid JSON should be an error.
 *
 * @param text The text to parse.
 * @returns The parsed value, or `undefined` when `text` is not valid JSON.
 *
 * @example
 * const record = parseJsonOrUndefined(line);
 * const level = isObject(record) ? record.level : undefined;
 */
export function parseJsonOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Narrows an unknown value to a plain (non-array, non-null) object. Shared by
 * the commands and the file-writer that walk parsed JSON, so the predicate
 * isn't reimplemented per call site.
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param target - The object to lay a patch over. It is not changed.
 * @param patch - What to lay over it.
 * @returns A new object: `target` with `patch` over it, where objects found at
 * the same key are merged and everything else, arrays included, is replaced.
 */
export function deepMerge(
  target: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const entries = Object.entries(patch).map(([key, item]) => {
    const existing = target[key];
    const value = isObject(item) && isObject(existing) ? deepMerge(existing, item) : item;

    return [key, value] as const;
  });

  return {
    ...target,
    ...Object.fromEntries(entries),
  };
}
