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
 * Replace (or insert) one top-level key's value in a JSON document by
 * splicing text, leaving every other byte of the source untouched. The
 * counterpart of {@link stableStringify} for files the CLI does *not* own
 * (the user's `package.json`): blank lines, inline nested objects, key
 * order, indentation style, line endings, and the trailing newline all
 * survive, because nothing outside the spliced value is reserialized. The
 * replaced value itself is rendered at the document's detected indent (a
 * compact document stays compact).
 *
 * Defensive by construction: the result is re-parsed and compared against
 * the expected mutation, so a splice that would corrupt the document throws
 * instead of writing it.
 */
export function setTopLevelJsonKey(
  source: string,
  path: string,
  key: string,
  value: unknown,
): string {
  const parsed = parseJsonObject(source, path);
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const indent = detectIndent(source);
  const rendered = renderValueAtDepthOne(value, indent, eol);
  const layout = scanTopLevel(source);
  const member = layout.members.find((candidate) => candidate.key === key);

  let next: string;
  if (member) {
    next = `${source.slice(0, member.valueStart)}${rendered}${source.slice(member.valueEnd)}`;
  } else if (layout.members.length === 0) {
    const inner =
      indent === 0
        ? `${JSON.stringify(key)}:${rendered}`
        : `${eol}${indentString(indent)}${JSON.stringify(key)}: ${rendered}${eol}`;
    next = `${source.slice(0, layout.open + 1)}${inner}${source.slice(layout.close)}`;
  } else {
    const last = layout.members[layout.members.length - 1]!;
    const inner =
      indent === 0
        ? `,${JSON.stringify(key)}:${rendered}`
        : `,${eol}${indentString(indent)}${JSON.stringify(key)}: ${rendered}`;
    next = `${source.slice(0, last.valueEnd)}${inner}${source.slice(last.valueEnd)}`;
  }

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

function indentString(indent: string | number): string {
  return typeof indent === "number" ? " ".repeat(indent) : indent;
}

/** Serializes a value as it should appear as a top-level member's value. */
function renderValueAtDepthOne(value: unknown, indent: string | number, eol: string): string {
  if (indent === 0) {
    return JSON.stringify(value);
  }
  const unit = indentString(indent);
  // Re-indent every continuation line one level deeper and re-join with the
  // document's own line endings.
  return JSON.stringify(value, null, unit).split("\n").join(`${eol}${unit}`);
}

type TopLevelMember = { key: string; valueStart: number; valueEnd: number };
type TopLevelLayout = { open: number; close: number; members: TopLevelMember[] };

/**
 * Single-pass, string-aware scan of a JSON object document, collecting the
 * exact text span of every top-level member's value plus the root braces.
 * Only structural understanding needed for the splice — the document has
 * already been validated by `JSON.parse`, so this can assume well-formed
 * input and does not re-validate.
 */
function scanTopLevel(source: string): TopLevelLayout {
  const members: TopLevelMember[] = [];
  let open = -1;
  let close = -1;
  let depth = 0;
  let index = 0;

  while (index < source.length) {
    const char = source[index]!;
    if (char === '"') {
      const start = index;
      index = skipString(source, index);
      if (depth === 1 && isKeyPosition(source, start)) {
        const key = JSON.parse(source.slice(start, index)) as string;
        // Skip to the value after the colon.
        while (source[index] !== ":") index += 1;
        index += 1;
        while (index < source.length && isWhitespace(source[index]!)) index += 1;
        const valueStart = index;
        index = skipValue(source, index);
        members.push({ key, valueStart, valueEnd: index });
      }
      continue;
    }
    if (char === "{" || char === "[") {
      depth += 1;
      if (depth === 1 && open === -1) {
        open = index;
      }
    } else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) {
        close = index;
      }
    }
    index += 1;
  }
  return { open, close, members };
}

/** True when the string starting at `start` is a top-level key, not a value. */
function isKeyPosition(source: string, start: number): boolean {
  for (let index = start - 1; index >= 0; index -= 1) {
    const char = source[index]!;
    if (isWhitespace(char)) continue;
    return char === "{" || char === ",";
  }
  return false;
}

/** Returns the index just past the value starting at `index`. */
function skipValue(source: string, index: number): number {
  const char = source[index]!;
  if (char === '"') {
    return skipString(source, index);
  }
  if (char === "{" || char === "[") {
    let depth = 0;
    let cursor = index;
    while (cursor < source.length) {
      const current = source[cursor]!;
      if (current === '"') {
        cursor = skipString(source, cursor);
        continue;
      }
      if (current === "{" || current === "[") depth += 1;
      if (current === "}" || current === "]") {
        depth -= 1;
        if (depth === 0) return cursor + 1;
      }
      cursor += 1;
    }
    return cursor;
  }
  // Primitive: number, boolean, null — runs until a structural delimiter.
  let cursor = index;
  while (cursor < source.length && !",}]".includes(source[cursor]!) && !isWhitespace(source[cursor]!)) {
    cursor += 1;
  }
  return cursor;
}

/** Returns the index just past the closing quote of the string at `index`. */
function skipString(source: string, index: number): number {
  let cursor = index + 1;
  while (cursor < source.length) {
    const char = source[cursor]!;
    if (char === "\\") {
      cursor += 2;
      continue;
    }
    if (char === '"') {
      return cursor + 1;
    }
    cursor += 1;
  }
  return cursor;
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
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
