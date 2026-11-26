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

/** What `read` fills for every flag and argument (`src/cli/core/flags.ts`). */
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

/** A class declared under `src`: the fields an instance owns and the class it extends. */
type Shape = Readonly<{
  /** The instance fields it declares, parameter properties included. */
  fields: readonly string[];
  /** The class it extends, by name, if it extends one. */
  parent: string | undefined;
}>;

/**
 * Every class declared under `src`, by name. A throw spreads the error it
 * caught (`{ ...error, message: error.message }`), so the names a spread
 * fills are the fields of the class the error was narrowed to.
 *
 * @returns The classes.
 */
async function classesUnder(): Promise<ReadonlyMap<string, Shape>> {
  const found = new Map<string, Shape>();
  for (const file of await sourcesUnder(root)) {
    const source = await parsedFile(join(root, file));
    for (const declaration of nodesOf(source, ts.isClassDeclaration)) {
      if (declaration.name === undefined) {
        continue;
      }
      const declared = declaration.members.flatMap((member) => {
        if (
          ts.isPropertyDeclaration(member) &&
          ts.isIdentifier(member.name) &&
          !(ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static)
        ) {
          return [member.name.text];
        }
        if (ts.isConstructorDeclaration(member)) {
          return member.parameters.flatMap((parameter) => {
            return ts.isParameterPropertyDeclaration(parameter, member) &&
              ts.isIdentifier(parameter.name)
              ? [parameter.name.text]
              : [];
          });
        }
        return [];
      });
      const extended = declaration.heritageClauses
        ?.find((clause) => {
          return clause.token === ts.SyntaxKind.ExtendsKeyword;
        })
        ?.types.at(0)?.expression;
      found.set(declaration.name.text, {
        fields: declared,
        parent: extended !== undefined && ts.isIdentifier(extended) ? extended.text : undefined,
      });
    }
  }
  return found;
}

/** The classes, read once for every refusal that spreads an error. */
const CLASSES = classesUnder();

/**
 * The fields an instance of `name` owns, its ancestors' included.
 *
 * @param classes - The classes under `src`.
 * @param name - The class.
 * @returns The fields, or none for a class declared outside `src`.
 */
function fieldsOf(classes: ReadonlyMap<string, Shape>, name: string | undefined): string[] {
  const shape = name === undefined ? undefined : classes.get(name);
  if (shape === undefined) {
    return [];
  }
  return [...shape.fields, ...fieldsOf(classes, shape.parent)];
}

/**
 * The class `node`'s variable `name` is known to be where `node` sits: the
 * right side of the nearest enclosing `if (name instanceof Class)`, or the
 * type a parameter of that name is declared with.
 *
 * @param node - Where the variable is read.
 * @param name - The variable.
 * @returns The class's name, if one is known.
 */
function narrowedTo(node: ts.Node | undefined, name: string): string | undefined {
  if (node === undefined) {
    return undefined;
  }
  if (
    ts.isIfStatement(node) &&
    ts.isBinaryExpression(node.expression) &&
    node.expression.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
    ts.isIdentifier(node.expression.left) &&
    node.expression.left.text === name &&
    ts.isIdentifier(node.expression.right)
  ) {
    return node.expression.right.text;
  }
  if (ts.isFunctionLike(node)) {
    const parameter = node.parameters.find((one) => {
      return ts.isIdentifier(one.name) && one.name.text === name;
    });
    if (
      parameter?.type !== undefined &&
      ts.isTypeReferenceNode(parameter.type) &&
      ts.isIdentifier(parameter.type.typeName)
    ) {
      return parameter.type.typeName.text;
    }
  }
  return narrowedTo(node.parent, name);
}

/**
 * The keys an object literal gives values for, the ones its spreads fill
 * included: a spread of an error narrowed to a class fills that class's
 * fields, and a spread of a call to a function of `source` whose return type
 * is written out fills that type's members.
 *
 * @param source - The parsed module.
 * @param classes - The classes under `src`.
 * @param node - The object literal.
 * @returns The keys.
 */
function filledBy(
  source: ts.SourceFile,
  classes: ReadonlyMap<string, Shape>,
  node: ts.Node | undefined,
): string[] {
  if (node === undefined || !ts.isObjectLiteralExpression(node)) {
    return [];
  }
  const spread = node.properties.flatMap((property) => {
    if (!ts.isSpreadAssignment(property)) {
      return [];
    }
    const spreading = property.expression;
    if (ts.isIdentifier(spreading)) {
      return fieldsOf(classes, narrowedTo(property, spreading.text));
    }
    if (ts.isCallExpression(spreading) && ts.isIdentifier(spreading.expression)) {
      const callee = spreading.expression.text;
      return nodesOf(source, ts.isFunctionDeclaration)
        .filter((declaration) => {
          return declaration.name?.text === callee;
        })
        .flatMap((declaration) => {
          return declaration.type !== undefined && ts.isTypeLiteralNode(declaration.type)
            ? declaration.type.members.flatMap((member) => {
                return member.name !== undefined && ts.isIdentifier(member.name)
                  ? [member.name.text]
                  : [];
              })
            : [];
        });
    }
    return [];
  });
  return [...keysOf(node), ...spread];
}

/**
 * The keys each throw of `name` in `source` gives values for, one list per
 * throw: its wording's values ({@link filledBy}) and the values its
 * whole-placeholder `next` entries are filled from. A throw counts when its
 * first argument names `name` as an identifier, a refusal chosen by a
 * condition included, so `LIMIT` is not credited with what a throw of
 * `MAX_LIMIT` passes.
 *
 * @param source - The parsed module.
 * @param classes - The classes under `src`.
 * @param name - The refusal's const.
 * @returns The keys, per throw.
 */
function thrownWith(
  source: ts.SourceFile,
  classes: ReadonlyMap<string, Shape>,
  name: string,
): string[][] {
  return callsOf(source, ["refusalError"])
    .filter((call) => {
      return identifiersIn(call.arguments[0]).includes(name);
    })
    .map((call) => {
      return [...filledBy(source, classes, call.arguments[1]), ...keysOf(call.arguments[2])];
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
  const classes = await CLASSES;
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
          ...thrownWith(source, classes, name),
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
