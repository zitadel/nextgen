import { join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  callsOf,
  declaredAs,
  identifiersIn,
  joinsStrings,
  keysOf,
  nodesOf,
  parsedFile,
  sourcesUnder,
  textsIn,
  propertyValue,
} from "@tests/helpers/declarations";

const root = fileURLToPath(new URL("../../../../src", import.meta.url));

/** What `read` fills for every flag and argument (`src/lib/oclif/flags.ts`). */
const ALWAYS = ["value", "input", "problem"];

/** The name inside each `{…}` of a refusal's wording, as `interpolate` reads one. */
const PLACEHOLDER = /\{([\w-]+)\}/g;

/** One refusal, with its wording and the names something fills it with. */
type Weighed = Readonly<{
  /** The file it is declared in, relative to `src`. */
  file: string;
  /** The const that holds it. */
  name: string;
  /** Its declaration, as parsed. */
  literal: ts.ObjectLiteralExpression;
  /**
   * Each way it is raised, as the names that way fills: `read` filling its
   * own, or one throw. Every way must fill every name its wording asks for.
   */
  raised: readonly (readonly string[])[];
}>;

/**
 * The keys each throw of `name` in `source` gives values for, one list per
 * throw: its wording's values and the values its whole-placeholder `next`
 * entries are filled from. A throw counts when its first argument names
 * `name` as an identifier, a refusal chosen by a condition included, so
 * `LIMIT` is not credited with what a throw of `MAX_LIMIT` passes.
 *
 * @param source - The parsed module.
 * @param name - The refusal's const.
 * @returns The keys, per throw.
 */
function thrownWith(source: ts.SourceFile, name: string): string[][] {
  return callsOf(source, ["refusalError"])
    .filter((call) => {
      return identifiersIn(call.arguments[0]).includes(name);
    })
    .map((call) => {
      return [...keysOf(call.arguments[1]), ...keysOf(call.arguments[2])];
    });
}

/**
 * Whether `read` fills `name` as a flag's refusal: a declaration names it as
 * its `refusal`, or a `ParseRefusal` is given it, as `readsFilled`'s empty
 * value is.
 *
 * @param source - The parsed module.
 * @param name - The refusal's const.
 * @returns Whether `read` raises it.
 */
function readWith(source: ts.SourceFile, name: string): boolean {
  const asRefusal = nodesOf(source, ts.isPropertyAssignment).some((property) => {
    return (
      ts.isIdentifier(property.name) &&
      property.name.text === "refusal" &&
      ts.isIdentifier(property.initializer) &&
      property.initializer.text === name
    );
  });
  const asParseRefusal = nodesOf(source, ts.isVariableDeclaration).some((declaration) => {
    return (
      declaration.type !== undefined &&
      ts.isTypeReferenceNode(declaration.type) &&
      ts.isIdentifier(declaration.type.typeName) &&
      declaration.type.typeName.text === "ParseRefusal" &&
      identifiersIn(declaration.initializer).includes(name)
    );
  });
  return asRefusal || asParseRefusal;
}

/**
 * `ways`, or one way that fills nothing when there are none, so a refusal
 * nothing raises is still weighed.
 *
 * @param ways - The ways a refusal is raised.
 * @returns The ways to weigh.
 */
function raisedAny(ways: readonly (readonly string[])[]): readonly (readonly string[])[] {
  return ways.length === 0 ? [[]] : ways;
}

/**
 * Every refusal declared in `src`, each with the ways it is raised. A
 * `Refused` is raised by `read`, which fills its own names and the
 * declaration's `values`. A `Refusal` or a `ParseRefusal` is raised by each
 * throw of it in its module, and by `read` where a flag raises it
 * ({@link readWith}); one raised no way at all fills nothing. A name one way
 * leaves out reaches the person as braces.
 *
 * @returns The refusals.
 */
async function weighed(): Promise<Weighed[]> {
  const found: Weighed[] = [];
  for (const file of await sourcesUnder(root)) {
    const source = await parsedFile(join(root, file));
    for (const { name, literal } of declaredAs(source, "Refused")) {
      found.push({
        file,
        name,
        literal,
        raised: [[...ALWAYS, ...keysOf(propertyValue(literal, "values"))]],
      });
    }
    for (const { name, literal } of [
      ...declaredAs(source, "Refusal"),
      ...declaredAs(source, "ParseRefusal"),
    ]) {
      found.push({
        file,
        name,
        literal,
        raised: raisedAny([
          ...(readWith(source, name) ? [ALWAYS] : []),
          ...thrownWith(source, name),
        ]),
      });
    }
  }
  return found;
}

/** The refusals, read once for every test that weighs them. */
const REFUSALS = weighed();

/**
 * A refusal's wording reaches the person, so a placeholder nothing fills shows
 * them `{min}` where a number belonged. The compiler refuses one where it can
 * read the wording; this weighs every refusal, so one it cannot read is caught
 * too: a refusal chosen by a condition, or one typed with an annotation
 * because its `next` would make its type circular.
 */
describe("what a flag or argument is refused for", () => {
  it("asks only for what something fills", async () => {
    const defective = (await REFUSALS).flatMap((refusal) => {
      const asked = textsIn(refusal.literal).flatMap((text) => {
        return [...text.matchAll(PLACEHOLDER)].flatMap((match) => {
          return match[1] === undefined ? [] : [match[1]];
        });
      });
      const unfilled = [...new Set(asked)].filter((name) => {
        return refusal.raised.some((way) => {
          return !way.includes(name);
        });
      });
      return unfilled.length === 0
        ? []
        : [`${refusal.file}: ${refusal.name} ${unfilled.map((n) => `{${n}}`).join(", ")}`];
    });

    expect(defective).toEqual([]);
  });

  it("is worded in literals the compiler can read, never joined with +", async () => {
    const joined = (await REFUSALS).flatMap((refusal) => {
      return joinsStrings(refusal.literal) ? [`${refusal.file}: ${refusal.name}`] : [];
    });

    expect(joined).toEqual([]);
  });
});
