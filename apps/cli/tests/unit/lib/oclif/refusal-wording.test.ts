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

/**
 * What a flag or argument is refused for. Only these are weighed: `read`
 * (`src/lib/oclif/flags.ts`) is their only caller, so the declaration is the
 * only place their wording can be filled from. A `Refusal` thrown by hand is
 * filled at the throw, which sits beside it in the same file.
 */
const DECLARATION = /const \w+: Refused<[^>]*> = \{/g;

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

/** Every refusal declared in `src`, each with the text it was declared as. */
async function declared(): Promise<Declared[]> {
  const found: Declared[] = [];
  for (const file of await sources()) {
    const source = await readFile(join(root, file), "utf8");
    for (const match of source.matchAll(DECLARATION)) {
      const opened = match.index + match[0].length - 1;
      found.push({ file, text: literalAt(source, opened) });
    }
  }
  return found;
}

/** What a refusal's wording asks for that nothing in its declaration fills. */
function unfilled(text: string): string[] {
  const asked = [...text.matchAll(PLACEHOLDER)].map((match) => match[1] as string);
  const filled = [
    ...ALWAYS,
    ...[...text.matchAll(/^\s{2,}([\w-]+):/gm)].map((m) => m[1] as string),
  ];
  return [...new Set(asked.filter((name) => !filled.includes(name)))];
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
