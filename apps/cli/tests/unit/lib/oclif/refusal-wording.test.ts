import { readFile, readdir } from "node:fs/promises";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../../src", import.meta.url));

/** What `read` fills for every flag and argument (`src/lib/oclif/flags.ts`). */
const ALWAYS = ["value", "input", "problem"];

/**
 * The name inside each `{…}` of a refusal's wording. A `${…}` is JavaScript's
 * own interpolation, already resolved where the refusal was written.
 */
const PLACEHOLDER = /(?<!\$)\{([\w-]+)\}/g;

/** What a flag or argument is refused for, filled only by `read`. */
const REFUSED = /const (\w+): Refused<[^>]*> = \{/g;

/** A refusal thrown by hand, filled by whoever throws it. */
const REFUSAL = /const (\w+): Refusal = \{/g;

/**
 * Where a refusal is thrown: everything from the call to the values it hands
 * over, so a refusal chosen by a condition — `problem === "too-long" ? A : B`
 * — is paired with its values as surely as one named outright.
 */
const THROWN = /refusalError\(([^{]*)\{/g;

type Declared = Readonly<{ file: string; text: string }>;

/** Every `.ts` file under `src`, as a path relative to it. */
async function sources(): Promise<string[]> {
  const files = await readdir(root, { recursive: true });
  return files.filter((file) => file.endsWith(".ts")).map((file) => file.split(sep).join("/"));
}

/**
 * The object literal that starts at `opened`, read to its matching brace, so a
 * refusal's wording and its `values` are weighed together.
 */
function literalAt(source: string, opened: number): string {
  let depth = 0;
  for (let at = opened; at < source.length; at++) {
    if (source[at] === "{") {
      depth++;
    }
    if (source[at] === "}") {
      depth--;
      if (depth === 0) {
        return source.slice(opened, at + 1);
      }
    }
  }
  return source.slice(opened);
}

/**
 * Every refusal declared in `src`, each with its wording and everything that
 * fills it.
 *
 * A `Refused` is filled by `read` alone, so its own declaration is all there
 * is. A `Refusal` is filled wherever it is thrown, so each `refusalError` of
 * it in the same file counts too — a name no throw of it ever passes reaches
 * the person as braces.
 */
/**
 * The values a throw hands over, opening at `opened`: the wording's values and,
 * after them, the values its whole-placeholder `next` entries are filled from.
 *
 * @param source - The module's source.
 * @param opened - Where the first values literal opens.
 * @returns Both literals, one after the other.
 */
function valuesAt(source: string, opened: number): string {
  const values = literalAt(source, opened);
  const after = source.slice(opened + values.length);
  const next = /^\s*,\s*\{/.exec(after);

  return next === null
    ? values
    : `${values}\n${literalAt(source, opened + values.length + next[0].length - 1)}`;
}

async function declared(): Promise<Declared[]> {
  const found: Declared[] = [];
  for (const file of await sources()) {
    const source = await readFile(join(root, file), "utf8");
    for (const match of source.matchAll(REFUSED)) {
      const opened = match.index + match[0].length - 1;
      found.push({ file, text: literalAt(source, opened) });
    }
    for (const match of source.matchAll(REFUSAL)) {
      const opened = match.index + match[0].length - 1;
      const thrown = [...source.matchAll(THROWN)]
        .filter((throwing) => (throwing[1] ?? "").includes(match[1] as string))
        .map((throwing) => valuesAt(source, throwing.index + throwing[0].length - 1));
      // A refusal nothing throws is dead, which another test would catch; it
      // is weighed on its wording alone.
      found.push({ file, text: [literalAt(source, opened), ...thrown].join("\n") });
    }
  }
  return found;
}

/** What a refusal's wording asks for that nothing in its declaration fills. */
function unfilled(text: string): string[] {
  const asked = [...text.matchAll(PLACEHOLDER)].map((match) => match[1] as string);
  // A key is written every way a property can be — `reason: reason`, the
  // shorthand `reason`, a spread — and a literal handed to a throw is as
  // often one line as several, so a key is read from what opens it rather
  // than from the indentation it happens to sit at. The wording is taken out
  // first: a placeholder reads exactly like a shorthand property, so a
  // refusal's own `{reason}` would otherwise count as filling itself.
  const code = text.replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '""');
  // The delimiter that ends a key is looked ahead to, not consumed: it opens
  // the key after it, and a match that ate it would skip every second one.
  const keys = [...code.matchAll(/[{,]\s*\.{0,3}([\w-]+)\s*(?=[:,}])/g)].map(
    (match) => match[1] as string,
  );
  return [...new Set(asked.filter((name) => ![...ALWAYS, ...keys].includes(name)))];
}

/**
 * A refusal's wording reaches the person, so a placeholder nothing fills shows
 * them `{min}` where a number belonged. `interpolate` leaves it rather than
 * throwing, because a refusal is worth more than the defect in its own
 * wording, which makes this the only thing that catches one.
 */
describe("what a flag or argument is refused for", () => {
  it("asks only for what something fills", async () => {
    const defective = (await declared())
      .map((refusal) => {
        return {
          file: refusal.file,
          unfilled: unfilled(refusal.text),
        };
      })
      .filter((refusal) => refusal.unfilled.length > 0)
      .map((refusal) => `${refusal.file}: ${refusal.unfilled.map((n) => `{${n}}`).join(", ")}`);

    expect(defective).toEqual([]);
  });
});
