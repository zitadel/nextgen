import { ConfigError } from "@/lib/zitadel/errors";
import type { JsonObject, JsonValue } from "@/lib/zitadel/types";
import type { MissingReference } from "@/lib/zitadel/storage/types";
import { isJsonArray, isJsonObject } from "@/lib/zitadel/utils/json";

/**
 * The key of a `{ "$file": "./x" }` reference.
 */
const FILE_REFERENCE_KEY = "$file";

/**
 * The keys and list indexes from a document's root down to one value.
 */
export type JsonLocation = readonly (string | number)[];

/**
 * A reference found in a document: the keys and indexes leading to it, and
 * what it names.
 */
export type FoundReference = {
  /**
   * The keys and list indexes from the document's root down to the reference.
   */
  readonly location: JsonLocation;

  /**
   * The path the reference names, as written.
   */
  readonly ref: string;
};

/**
 * The marker for a value left out because the file it referenced cannot be
 * read, so the walk can drop it from its parent.
 */
const omitted = Symbol("omitted");

/**
 * The path a value references, when it is a `{ "$file": "<path>" }` object and
 * nothing else.
 *
 * @param value - Any JSON value.
 * @returns The path it references, or `undefined` when it is not a reference.
 */
function referenceIn(value: JsonValue | undefined): string | undefined {
  if (!isJsonObject(value) || Object.keys(value).length !== 1) {
    return undefined;
  }
  const ref = value[FILE_REFERENCE_KEY];
  if (typeof ref === "string") {
    return ref;
  }
  return undefined;
}

/**
 * The references in one value of a document and everything under it.
 *
 * @param node - The value.
 * @param location - The keys and indexes leading to it.
 * @returns Its references, in document order.
 */
function referencesUnder(
  node: JsonValue | undefined,
  location: JsonLocation,
): readonly FoundReference[] {
  const ref = referenceIn(node);
  if (ref !== undefined) {
    return [{ location, ref }];
  }
  if (isJsonArray(node)) {
    return node.flatMap((item, index) => {
      return referencesUnder(item, [...location, index]);
    });
  }
  if (isJsonObject(node)) {
    return Object.entries(node).flatMap((entry) => {
      return referencesUnder(entry[1], [...location, entry[0]]);
    });
  }
  return [];
}

/**
 * Every `$file` reference in a document, in document order.
 *
 * @param document - The document.
 * @returns Each reference and where it is.
 */
export function findFileReferences(document: JsonValue): readonly FoundReference[] {
  return referencesUnder(document, []);
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
   * One value of the document with its references inlined.
   *
   * @param node - The value.
   * @returns The inlined value, or {@link omitted} for a reference left out.
   * @throws {@link ConfigError} When a reference cannot be read, under `throw`.
   */
  const inline = (node: JsonValue | undefined): JsonValue | undefined | typeof omitted => {
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
    if (isJsonArray(node)) {
      return node.map(inline).filter((item): item is JsonValue => {
        return item !== omitted && item !== undefined;
      });
    }
    if (isJsonObject(node)) {
      return Object.fromEntries(
        Object.entries(node).flatMap((entry): readonly (readonly [string, JsonValue])[] => {
          const inlined = inline(entry[1]);
          // An absent member stays absent, as a left-out reference does.
          if (inlined === omitted || inlined === undefined) {
            return [];
          }
          return [[entry[0], inlined]];
        }),
      );
    }
    return node;
  };
  const inlined = inline(document);
  if (inlined === omitted || !isJsonObject(inlined)) {
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

/**
 * The directory, relative to the project, that every file a store writes or
 * removes must stay inside.
 */
export const CONFIG_ROOT = ".zitadel";

/**
 * The failure for a file to write or remove that leads outside `.zitadel/`,
 * which every store refuses alike.
 *
 * @param path - The project-relative path as given.
 * @returns The error to throw.
 */
export function outsideConfig(path: string): ConfigError {
  return new ConfigError(`${path} points outside ${CONFIG_ROOT}/`, {
    hint: "Files are only written and removed inside .zitadel/.",
    details: { file: path },
  });
}
