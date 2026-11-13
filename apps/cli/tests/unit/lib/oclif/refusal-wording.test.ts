import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { codeOf, declaredAs, keysOf, objectAt, sourcesUnder } from "@tests/helpers/declarations";

const root = fileURLToPath(new URL("../../../../src", import.meta.url));

/** What `read` fills for every flag and argument (`src/lib/oclif/flags.ts`). */
const ALWAYS = ["value", "input", "problem"];

/**
 * The name inside each `{…}` of a refusal's wording. A `${…}` is JavaScript's
 * own interpolation, already resolved where the refusal was written.
 */
const PLACEHOLDER = /(?<!\$)\{([\w-]+)\}/g;

/** Where a `Refused` declaration's own `values` open. */
const VALUES = /\bvalues:\s*\{/;

/**
 * Where a refusal is thrown: everything from the call to the values it hands
 * over, so a refusal chosen by a condition — `problem === "too-long" ? A : B`
 * — is paired with its values as surely as one named outright.
 */
const THROWN = /refusalError\(([^{]*)\{/g;

/** Wording joined with `+`, which the compiler can read only as `string`. */
const JOINED = /["'`]\s*\+|\+\s*["'`]/;

/** One refusal, with its wording and the names something fills it with. */
type Weighed = Readonly<{
  /** The file it is declared in, relative to `src`. */
  file: string;
  /** The const that holds it. */
  name: string;
  /** Its declaration, wording and all. */
  wording: string;
  /** Each name a value is given for wherever it is raised. */
  filled: readonly string[];
}>;

/**
 * The values each throw of `name` in `source` hands over: the wording's values
 * and, after them, the values its whole-placeholder `next` entries are filled
 * from. A throw counts when its first argument names `name` as a whole word,
 * so `LIMIT` is not credited with what a throw of `MAX_LIMIT` passes.
 *
 * @param source - The module's source.
 * @param name - The refusal's const.
 * @returns The keys the throws give values for.
 */
function thrownWith(source: string, name: string): string[] {
  const named = new RegExp(`\\b${name}\\b`);
  return [...source.matchAll(THROWN)]
    .filter((throwing) => {
      return named.test(throwing[1] ?? "");
    })
    .flatMap((throwing) => {
      const opened = throwing.index + throwing[0].length - 1;
      const values = objectAt(source, opened);
      const after = source.slice(opened + values.length);
      const next = /^\s*,\s*\{/.exec(after);
      const nextValues =
        next === null ? "" : objectAt(source, opened + values.length + next[0].length - 1);

      return [...keysOf(values), ...keysOf(nextValues)];
    });
}

/**
 * Every refusal declared in `src`, each with its wording and what fills it.
 * A `Refused` is filled by `read` and its own `values`, nothing else. A
 * `Refusal` is filled wherever it is thrown, so each `refusalError` of it in
 * the same file counts — a name no throw of it passes reaches the person as
 * braces — and by `read` too where a flag's declaration names it as its
 * `refusal`, or a `ParseRefusal` is given it, as `readsFilled`'s empty value is.
 *
 * @returns The refusals.
 */
async function weighed(): Promise<Weighed[]> {
  const found: Weighed[] = [];
  for (const file of await sourcesUnder(root)) {
    const source = await readFile(join(root, file), "utf8");
    const code = codeOf(source);
    for (const { name, literal } of declaredAs(source, "Refused")) {
      const values = VALUES.exec(literal);
      const own =
        values === null ? [] : keysOf(objectAt(literal, values.index + values[0].length - 1));
      found.push({ file, name, wording: literal, filled: [...ALWAYS, ...own] });
    }
    for (const { name, literal } of declaredAs(source, "Refusal")) {
      const parsed = new RegExp(`(?:refusal:\\s*|: ParseRefusal = [^;\\n]*)\\b${name}\\b`).test(
        code,
      );
      found.push({
        file,
        name,
        wording: literal,
        filled: [...(parsed ? ALWAYS : []), ...thrownWith(source, name)],
      });
    }
  }
  return found;
}

/**
 * A refusal's wording reaches the person, so a placeholder nothing fills shows
 * them `{min}` where a number belonged. The compiler refuses one where it can
 * read the wording; this weighs every refusal, so one it cannot read is caught
 * too: a refusal chosen by a condition, or one typed with an annotation
 * because its `next` would make its type circular.
 */
describe("what a flag or argument is refused for", () => {
  it("asks only for what something fills", async () => {
    const defective = (await weighed()).flatMap((refusal) => {
      const asked = [...refusal.wording.matchAll(PLACEHOLDER)].flatMap((match) => {
        return match[1] === undefined ? [] : [match[1]];
      });
      const unfilled = [...new Set(asked)].filter((name) => {
        return !refusal.filled.includes(name);
      });
      return unfilled.length === 0
        ? []
        : [`${refusal.file}: ${refusal.name} ${unfilled.map((n) => `{${n}}`).join(", ")}`];
    });

    expect(defective).toEqual([]);
  });

  it("is worded in literals the compiler can read, never joined with +", async () => {
    const joined = (await weighed()).flatMap((refusal) => {
      return JOINED.test(refusal.wording) ? [`${refusal.file}: ${refusal.name}`] : [];
    });

    expect(joined).toEqual([]);
  });
});
