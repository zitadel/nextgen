import { relative, sep } from "node:path";

import { sourceFiles } from "./source-files";

/**
 * A const a module declares as a type: its name, and the object it holds from
 * its opening brace to its matching closing one.
 */
export type Declaration = Readonly<{
  /** The const's name, as the module spells it. */
  name: string;
  /** The object, braces included, exactly as the module writes it. */
  literal: string;
}>;

/**
 * Where a const that holds an object is declared, with or without a type
 * after its name. The type's arguments may nest (`Refused<ReadonlyArray<string>>`):
 * they run to the `>` that the ` = {` follows.
 */
const DECLARED = /\bconst (\w+)(?:: (\w+)(?:<.*?>)?)? = \{/g;

/**
 * What follows an object declared without a type, naming the type it
 * satisfies, with or without `as const`, on the same line or the next.
 */
const SATISFIES = /^\s*(?:as const\s+)?satisfies\s+(\w+)\b/;

/**
 * The characters after which a `/` opens a regex literal rather than dividing:
 * an operator, an opening bracket, or the start of the text.
 */
const BEFORE_A_REGEX = /[(,=:[!&|?{};+\-*%<>~^]$/;

/**
 * The end of the string, template, comment or regex literal that opens at
 * `at`, or `at` itself when nothing opens there.
 *
 * @param source - The module's source.
 * @param at - Where one may open.
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
  if (opener === "/" && BEFORE_A_REGEX.test(source.slice(0, at).trimEnd() || "(")) {
    let inClass = false;
    for (let end = at + 1; end < source.length; end++) {
      const character = source[end];
      if (character === "\\") {
        end++;
        continue;
      }
      if (character === "\n") {
        return end;
      }
      if (character === "[") {
        inClass = true;
      }
      if (character === "]") {
        inClass = false;
      }
      if (character === "/" && !inClass) {
        return end + 1;
      }
    }
    return source.length;
  }
  return at;
}

/**
 * `source` with every string, template and regex literal written as `""` and
 * every comment as a space, read in one pass so that none can hide another:
 * a `//` in a URL stays in its string, and a quote or a backtick in a comment
 * starts nothing.
 *
 * @param source - Code.
 * @returns The code, its structure kept and its text taken out.
 */
export function codeOf(source: string): string {
  let code = "";
  let at = 0;
  while (at < source.length) {
    const after = skipped(source, at);
    if (after === at) {
      code += source[at];
      at++;
      continue;
    }
    code += source.startsWith("//", at) || source.startsWith("/*", at) ? " " : '""';
    at = after;
  }
  return code;
}

/**
 * The object that opens at `opened`, read to its matching brace. A brace inside
 * a string, a template, a comment or a regex literal does not count, so
 * wording such as `"Pass '{'"` cannot end the object early.
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
 * A property's key where it opens, quoted (`"sso-client-id"`) or not, with
 * the `:`, `,` or `}` after it looked ahead to, not taken.
 */
const KEY = /^\s*(?:"([^"\n]+)"|'([^'\n]+)'|([\w$-]+))\s*(?=[:,}])/;

/**
 * Where the next key starts from `at`: past whitespace and any comment, which
 * may sit above a key and say why it is there.
 *
 * @param literal - The object.
 * @param at - Just after the `{` or `,` that opens the key.
 * @returns The index of the key's first character.
 */
function keyAt(literal: string, at: number): number {
  let next = at;
  while (next < literal.length) {
    if (/\s/.test(literal[next] ?? "")) {
      next++;
      continue;
    }
    if (literal.startsWith("//", next) || literal.startsWith("/*", next)) {
      next = skipped(literal, next);
      continue;
    }
    return next;
  }
  return next;
}

/**
 * The keys an object literal gives a value for itself, written every way a
 * property can be: `reason: reason`, or the shorthand `reason`. Only its own
 * keys count: a key of an object nested in it, an argument of a call in it, a
 * list's items, and a spread, which hides what it brings, give it nothing.
 *
 * @param literal - The object, braces included.
 * @returns Its keys.
 */
export function keysOf(literal: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let at = 0;
  while (at < literal.length) {
    const after = skipped(literal, at);
    if (after !== at) {
      at = after;
      continue;
    }
    const character = literal[at] ?? "";
    if ("([{".includes(character)) {
      depth++;
    }
    if (")]}".includes(character)) {
      depth--;
    }
    if (depth === 1 && (character === "{" || character === ",")) {
      const key = KEY.exec(literal.slice(keyAt(literal, at + 1)));
      const name = key?.[1] ?? key?.[2] ?? key?.[3];
      if (name !== undefined) {
        keys.push(name);
      }
    }
    at++;
  }
  return keys;
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
