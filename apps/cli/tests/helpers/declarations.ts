import { relative, sep } from "node:path";

import { sourceFiles } from "./source-files";

/** A const a module declares as a type: its name and the object it holds. */
export type Declaration = Readonly<{
  /** The const's name. */
  name: string;
  /** The object, from its opening brace to its matching closing one. */
  literal: string;
}>;

/** Where a const that holds an object is declared, with or without a type after its name. */
const DECLARED = /\bconst (\w+)(?:: (\w+)(?:<[^>\n]*>)?)? = \{/g;

/** What follows an object declared without a type, naming the type it satisfies. */
const SATISFIES = /^ as const satisfies (\w+)\b/;

/**
 * The end of the string, template or comment that opens at `at`, or `at`
 * itself when nothing opens there.
 *
 * @param source - The module's source.
 * @param at - Where a quote or a comment may open.
 * @returns The index just after it closes.
 */
function skipped(source: string, at: number): number {
  const opener = source[at];
  if (opener === '"' || opener === "'" || opener === "`") {
    for (let end = at + 1; end < source.length; end++) {
      if (source[end] === "\\") {
        end++;
        continue;
      }
      if (source[end] === opener) {
        return end + 1;
      }
    }
    return source.length;
  }
  if (source.startsWith("//", at)) {
    const end = source.indexOf("\n", at);
    return end === -1 ? source.length : end;
  }
  if (source.startsWith("/*", at)) {
    const end = source.indexOf("*/", at + 2);
    return end === -1 ? source.length : end + 2;
  }
  return at;
}

/**
 * The object that opens at `opened`, read to its matching brace. A brace inside
 * a string, a template or a comment does not count, so wording such as
 * `"Pass '{'"` cannot end the object early.
 *
 * @param source - The module's source.
 * @param opened - Where the object's `{` is.
 * @returns The object's text, braces included.
 */
export function objectAt(source: string, opened: number): string {
  let depth = 0;
  let at = opened;
  while (at < source.length) {
    const after = skipped(source, at);
    if (after !== at) {
      at = after;
      continue;
    }
    if (source[at] === "{") {
      depth++;
    }
    if (source[at] === "}") {
      depth--;
      if (depth === 0) {
        return source.slice(opened, at + 1);
      }
    }
    at++;
  }
  return source.slice(opened);
}

/**
 * Each const in `source` that holds an object declared as `type`, either way a
 * module writes one: `const NAME: Type = { … }`, or
 * `const NAME = { … } as const satisfies Type`.
 *
 * @param source - The module's source.
 * @param type - The type's name, without type arguments: `Refused`, `Refusal`.
 * @returns The declarations, in the order they appear.
 */
export function declaredAs(source: string, type: string): Declaration[] {
  return [...source.matchAll(DECLARED)].flatMap((match) => {
    const name = match[1];
    if (name === undefined) {
      return [];
    }
    const opened = match.index + match[0].length - 1;
    const literal = objectAt(source, opened);
    const declared = match[2] ?? SATISFIES.exec(source.slice(opened + literal.length))?.[1];

    return declared === type ? [{ name, literal }] : [];
  });
}

/**
 * Every `.ts` file under `dir`, as a path relative to it with `/` between its
 * parts, for a test that names the file a finding is in.
 *
 * @param dir - The directory to read.
 * @returns The paths.
 */
export async function sourcesUnder(dir: string): Promise<string[]> {
  return (await sourceFiles(dir)).map((file) => {
    return relative(dir, file).split(sep).join("/");
  });
}
