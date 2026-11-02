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

  const next = member
    ? `${source.slice(0, member.valueStart)}${rendered}${source.slice(member.valueEnd)}`
    : withAppended({ source, path, layout, key, rendered, indent, eol });

  const verification = parseJsonObject(next, path);
  const expected = { ...parsed, [key]: value };
  if (JSON.stringify(verification) !== JSON.stringify(expected)) {
    throw new Error(`refusing to write ${path}: the targeted JSON edit did not verify`);
  }
  return next;
}

/** `source` with a new `key` member added after the last one, or inside an empty object. */
function withAppended(input: {
  source: string;
  path: string;
  layout: TopLevelLayout;
  key: string;
  rendered: string;
  indent: ReturnType<typeof detectIndent>;
  eol: string;
}): string {
  const { source, path, layout, key, rendered, indent, eol } = input;
  const last = layout.members.at(-1);
  if (layout.members.length === 0) {
    const inner =
      indent === 0
        ? `${JSON.stringify(key)}:${rendered}`
        : `${eol}${indentString(indent)}${JSON.stringify(key)}: ${rendered}${eol}`;
    return `${source.slice(0, layout.open + 1)}${inner}${source.slice(layout.close)}`;
  }
  if (!last) {
    throw new Error(`refusing to write ${path}: the JSON layout scan found no members`);
  }
  const inner =
    indent === 0
      ? `,${JSON.stringify(key)}:${rendered}`
      : `,${eol}${indentString(indent)}${JSON.stringify(key)}: ${rendered}`;
  return `${source.slice(0, last.valueEnd)}${inner}${source.slice(last.valueEnd)}`;
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

type Token = { text: string; start: number; end: number };

/** A string, a bracket or separator, or a bare number, boolean or null. */
const TOKEN = /"[^"\\]*(?:\\[\s\S][^"\\]*)*"|[{}[\],:]|[^\s"{}[\],:]+/g;

/**
 * String-aware scan of a JSON object document, collecting the exact text span
 * of every top-level member's value plus the root braces. Only structural
 * understanding needed for the splice — the document has already been
 * validated by `JSON.parse`, so this can assume well-formed input and does not
 * re-validate.
 */
function scanTopLevel(source: string): TopLevelLayout {
  const tokens: Token[] = [...source.matchAll(TOKEN)].map((match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
  const opens = (token: Token) => token.text === "{" || token.text === "[";
  const closes = (token: Token) => token.text === "}" || token.text === "]";
  // The nesting depth after each token; strings and bare values never change it.
  const depthAfter = tokens.reduce<number[]>((depths, token) => {
    depths.push((depths.at(-1) ?? 0) + (opens(token) ? 1 : closes(token) ? -1 : 0));
    return depths;
  }, []);
  const depthBefore = (index: number) => depthAfter[index - 1] ?? 0;

  const members = tokens.flatMap((token, index): TopLevelMember[] => {
    const previous = tokens[index - 1]?.text;
    if (
      !token.text.startsWith('"') ||
      depthBefore(index) !== 1 ||
      (previous !== "{" && previous !== ",")
    ) {
      return [];
    }
    // The value follows the colon after the key.
    const valueIndex = index + 2;
    const value = tokens[valueIndex];
    if (value === undefined) {
      return [];
    }
    const closeIndex = opens(value) ? depthAfter.indexOf(1, valueIndex + 1) : valueIndex;
    return [
      {
        key: JSON.parse(source.slice(token.start, token.end)) as string,
        valueStart: value.start,
        valueEnd: tokens[closeIndex]?.end ?? source.length,
      },
    ];
  });
  const opening = tokens.findIndex((token, index) => opens(token) && depthAfter[index] === 1);
  const closing = tokens.filter((token, index) => closes(token) && depthAfter[index] === 0).at(-1);
  return {
    open: tokens[opening]?.start ?? -1,
    close: closing?.start ?? -1,
    members,
  };
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
