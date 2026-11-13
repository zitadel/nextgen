import { readFile } from "node:fs/promises";
import { relative, sep } from "node:path";

import ts from "typescript";

import { sourceFiles } from "./source-files";

/**
 * A const a module declares as a type, as the TypeScript parser reads it: its
 * name, and the object literal it holds.
 */
export type Declaration = Readonly<{
  /** The const's name, as the module spells it. */
  name: string;
  /** The object it holds, `as const` and `satisfies` taken off. */
  literal: ts.ObjectLiteralExpression;
}>;

/**
 * `text` parsed as TypeScript, with each node's parent set so a test can walk
 * up as well as down.
 *
 * @param file - The file's path, which names it in the parser's output.
 * @param text - Its source.
 * @returns The parsed file.
 */
export function parsedSource(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
}

/**
 * `file` read from disk and parsed ({@link parsedSource}).
 *
 * @param file - The file's path.
 * @returns The parsed file.
 */
export async function parsedFile(file: string): Promise<ts.SourceFile> {
  return parsedSource(file, await readFile(file, "utf8"));
}

/**
 * Every node under `root`, `root` included, that `is` accepts, in source order.
 *
 * @typeParam Found - What `is` narrows a node to.
 * @param root - Where to start.
 * @param is - Which nodes to keep.
 * @returns The nodes.
 */
export function nodesOf<Found extends ts.Node>(
  root: ts.Node,
  is: (node: ts.Node) => node is Found,
): Found[] {
  const found: Found[] = [];
  const visit = (node: ts.Node): void => {
    if (is(node)) {
      found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

/**
 * Whether `node` names the type `type`, with or without type arguments:
 * `Refused` and `Refused<ReadonlyArray<string>>` both name `Refused`.
 *
 * @param node - A type, if there is one.
 * @param type - The type's name.
 * @returns Whether it names it.
 */
function names(node: ts.TypeNode | undefined, type: string): boolean {
  return (
    node !== undefined &&
    ts.isTypeReferenceNode(node) &&
    ts.isIdentifier(node.typeName) &&
    node.typeName.text === type
  );
}

/**
 * Each const in `source` that holds an object literal declared as `type`,
 * however the module writes it: `const NAME: Type = { … }`,
 * `const NAME = { … } satisfies Type`, or the same with `as const` before the
 * `satisfies`.
 *
 * @param source - The parsed module.
 * @param type - The type's name, without type arguments: `Refused`, `Refusal`.
 * @returns The declarations, in the order they appear.
 */
export function declaredAs(source: ts.SourceFile, type: string): Declaration[] {
  return nodesOf(source, ts.isVariableDeclaration).flatMap((declaration) => {
    if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) {
      return [];
    }
    let held = declaration.initializer;
    let declared = names(declaration.type, type);
    if (ts.isSatisfiesExpression(held)) {
      declared = declared || names(held.type, type);
      held = held.expression;
    }
    if (ts.isAsExpression(held)) {
      held = held.expression;
    }

    return declared && ts.isObjectLiteralExpression(held)
      ? [{ name: declaration.name.text, literal: held }]
      : [];
  });
}

/**
 * The keys an object literal gives a value for itself: `reason: reason`, the
 * shorthand `reason`, or a quoted `"sso-client-id": …`. A spread, which hides
 * what it brings, and a computed key give it nothing, and nothing that is not
 * an object literal has keys.
 *
 * @param node - What may be an object literal.
 * @returns Its keys.
 */
export function keysOf(node: ts.Node | undefined): string[] {
  if (node === undefined || !ts.isObjectLiteralExpression(node)) {
    return [];
  }
  return node.properties.flatMap((property) => {
    if (ts.isShorthandPropertyAssignment(property)) {
      return [property.name.text];
    }
    if (
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
    ) {
      return [property.name.text];
    }
    return [];
  });
}

/**
 * The value `literal` gives `key` itself, if it gives one, under the key as an
 * identifier or quoted: `values: …` and `"values": …` alike.
 *
 * @param literal - An object literal.
 * @param key - A key it may give.
 * @returns The value's expression.
 */
export function valueOf(
  literal: ts.ObjectLiteralExpression,
  key: string,
): ts.Expression | undefined {
  const property = literal.properties.find((one) => {
    return (
      ts.isPropertyAssignment(one) &&
      (ts.isIdentifier(one.name) || ts.isStringLiteral(one.name)) &&
      one.name.text === key
    );
  });
  return property !== undefined && ts.isPropertyAssignment(property)
    ? property.initializer
    : undefined;
}

/**
 * Whether `node` is a string as the code writes it: a literal, a template
 * without substitutions, or a literal part of a template with them.
 *
 * @param node - A node.
 * @returns Whether it is one.
 */
function isText(
  node: ts.Node,
): node is
  | ts.StringLiteral
  | ts.NoSubstitutionTemplateLiteral
  | ts.TemplateHead
  | ts.TemplateMiddle
  | ts.TemplateTail {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  );
}

/**
 * The text of each string under `node` ({@link isText}). What a `${…}` holds
 * is code, already resolved where it was written, so it is left out.
 *
 * @param node - Where to look.
 * @returns The texts, in source order.
 */
export function textsIn(node: ts.Node): string[] {
  return nodesOf(node, isText).map((text) => {
    return text.text;
  });
}

/**
 * Whether anything under `node` joins a string with `+`, which the compiler
 * then reads only as `string`.
 *
 * @param node - Where to look.
 * @returns Whether a string is joined.
 */
export function joinsStrings(node: ts.Node): boolean {
  const stringish = (side: ts.Expression): boolean => {
    return isText(side) || ts.isTemplateExpression(side);
  };
  return nodesOf(node, ts.isBinaryExpression).some((binary) => {
    return (
      binary.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      (stringish(binary.left) || stringish(binary.right))
    );
  });
}

/**
 * The name of each identifier under `node`, as the code names it; a word in a
 * string or a comment is no identifier.
 *
 * @param node - Where to look, if anywhere.
 * @returns The names, in source order.
 */
export function identifiersIn(node: ts.Node | undefined): string[] {
  if (node === undefined) {
    return [];
  }
  return nodesOf(node, ts.isIdentifier).map((identifier) => {
    return identifier.text;
  });
}

/**
 * Each call under `root` of a function named one of `callees`, called by its
 * bare name: `refusalError(…)`, `reads(…)`.
 *
 * @param root - Where to look.
 * @param callees - The functions' names.
 * @returns The calls, in source order.
 */
export function callsOf(root: ts.Node, callees: readonly string[]): ts.CallExpression[] {
  return nodesOf(root, ts.isCallExpression).filter((call) => {
    return ts.isIdentifier(call.expression) && callees.includes(call.expression.text);
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
