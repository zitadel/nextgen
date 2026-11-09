import { ConfigError } from "@/lib/zitadel/errors";
import type { JsonObject } from "@/lib/zitadel/types";
import type { MissingReference } from "@/lib/zitadel/storage/types";
import { isJsonObject } from "@/lib/zitadel/utils/json";

/**
 * The key of a `{ "$file": "./x" }` reference.
 */
const FILE_REFERENCE_KEY = "$file";

/**
 * A reference found in a document: the keys and indexes leading to it, and
 * what it names.
 */
export type FoundReference = Readonly<{
  /**
   * The keys and list indexes from the document's root down to the reference.
   */
  location: ReadonlyArray<string | number>;
  /**
   * The path the reference names, as written.
   */
  ref: string;
}>;

/**
 * The marker for a value left out because the file it referenced cannot be
 * read, so the walk can drop it from its parent.
 */
const omitted = Symbol("omitted");

/**
 * The path a value references, when it is a `{ "$file": "<path>" }` object and
 * nothing else.
 *
 * @param value - Any parsed JSON value.
 * @returns The path it references, or `undefined` when it is not a reference.
 */
function referenceIn(value: unknown): string | undefined {
  if (!isJsonObject(value) || Object.keys(value).length !== 1) {
    return undefined;
  }
  const ref = value[FILE_REFERENCE_KEY];
  return typeof ref === "string" ? ref : undefined;
}

/**
 * Every `$file` reference in a document, in document order.
 *
 * @param document - The document.
 * @returns Each reference and where it is.
 */
export function findFileReferences(document: unknown): FoundReference[] {
  /**
   * The references in one node of the document and everything under it.
   *
   * @param node - The node.
   * @param location - The keys and indexes leading to it.
   * @returns Its references, in document order.
   */
  const walk = (node: unknown, location: ReadonlyArray<string | number>): FoundReference[] => {
    const ref = referenceIn(node);
    if (ref !== undefined) {
      return [{ location, ref }];
    }
    if (Array.isArray(node)) {
      return node.flatMap((item: unknown, index) => {
        return walk(item, [...location, index]);
      });
    }
    if (isJsonObject(node)) {
      return Object.entries(node).flatMap(([key, value]) => {
        return walk(value, [...location, key]);
      });
    }
    return [];
  };
  return walk(document, []);
}

/**
 * A copy of a document with every `$file` reference replaced by the text of
 * the file it names.
 *
 * @remarks
 * Nothing here knows which fields may carry a reference: the contracts decide
 * that, and the store decides how a path is read.
 *
 * @param document - The document.
 * @param read - The text of the file a reference names, or `undefined` when
 *   there is no such file.
 * @param missing - `throw` to refuse a reference that cannot be read, `omit`
 *   to leave its value out (the key from an object, the element from a list).
 * @returns The document with its references inlined.
 * @throws {@link ConfigError} When a reference cannot be read, under `throw`.
 */
export function inlineFileReferences(
  document: JsonObject,
  read: (ref: string) => string | undefined,
  missing: MissingReference,
): JsonObject {
  /**
   * One node of the document with its references inlined.
   *
   * @param node - The node.
   * @returns The inlined node, or {@link omitted} for a reference left out.
   * @throws {@link ConfigError} When a reference cannot be read, under `throw`.
   */
  const inline = (node: unknown): unknown => {
    const ref = referenceIn(node);
    if (ref !== undefined) {
      const text = read(ref);
      if (text !== undefined) {
        return text;
      }
      if (missing === "omit") {
        return omitted;
      }
      throw new ConfigError(`$file ${JSON.stringify(ref)} cannot be read`, {
        hint: "Create the referenced file or fix the path.",
      });
    }
    if (Array.isArray(node)) {
      return node.map(inline).filter((item) => {
        return item !== omitted;
      });
    }
    if (isJsonObject(node)) {
      return Object.fromEntries(
        Object.entries(node).flatMap(([key, value]): Array<[string, unknown]> => {
          const inlined = inline(value);
          return inlined === omitted ? [] : [[key, inlined]];
        }),
      );
    }
    return node;
  };
  const inlined = inline(document);
  if (!isJsonObject(inlined)) {
    return {};
  }
  return inlined;
}

/**
 * The failure for a `$file` reference that leads outside the project, which
 * every store refuses alike: a deploy uploads what a reference names.
 *
 * @param ref - The reference as written.
 * @returns The error to throw.
 */
export function outsideProject(ref: string): ConfigError {
  return new ConfigError(`$file ${JSON.stringify(ref)} points outside the project`, {
    hint:
      "Keep referenced files inside the project, next to the file that references them; " +
      "a symlink on the way must resolve inside the project too.",
  });
}
