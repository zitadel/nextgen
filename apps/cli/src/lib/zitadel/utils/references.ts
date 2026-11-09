import { ConfigError } from "@/lib/zitadel/errors";
import type { JsonObject } from "@/lib/zitadel/types";
import type { MissingReference } from "@/lib/zitadel/storage/types";
import { isJsonObject } from "@/lib/zitadel/utils/json";

/** The key of a `{ "$file": "./x" }` reference. */
const FILE_REFERENCE_KEY = "$file";

/** A reference found in a document: the keys and indexes leading to it, and what it names. */
export type FoundReference = Readonly<{
  location: ReadonlyArray<string | number>;
  ref: string;
}>;

/** A value left out because the file it referenced cannot be read. */
const omitted = Symbol("omitted");

/**
 * Whether a value is a `{ "$file": "<path>" }` object and nothing else.
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
 * the file it names. Nothing here knows which fields may carry a reference:
 * the contracts decide that, and the store decides how a path is read.
 *
 * @param document - The document.
 * @param read - The text of the file a reference names, or `undefined` when
 *   there is no such file.
 * @param missing - `throw` to refuse a reference that cannot be read, `omit`
 *   to leave its value out (the key from an object, the element from a list).
 * @returns The document with its references inlined.
 * @throws {@link ConfigError} For a reference that cannot be read, under `throw`.
 */
export function inlineFileReferences(
  document: JsonObject,
  read: (ref: string) => string | undefined,
  missing: MissingReference,
): JsonObject {
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
        Object.entries(node)
          .map(([key, value]) => {
            return [key, inline(value)] as const;
          })
          .filter(([, value]) => {
            return value !== omitted;
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
