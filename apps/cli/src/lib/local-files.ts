/**
 * Local file references in `.zitadel/` resource files.
 *
 * Wherever the OpenAPI YAML marks a string field `x-local: file`, the
 * generated editor meta-schema accepts `{ "$file": "<path>" }` in its place,
 * so a long value such as a login template lives in its own file instead of a
 * JSON-escaped string. The API never sees a reference: before upload every
 * one is replaced by the referenced file's content, and after a write the
 * server's canonical value goes back into that file while the JSON keeps the
 * reference.
 *
 * Resolution is generic. Nothing here knows which fields may carry a
 * reference; the Zod gate and the editor schema decide that.
 *
 * Paths are relative to the directory of the resource file that holds them
 * and must stay inside the project, because write-back writes to them.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { ZitadelError } from "./errors";

export const FILE_REFERENCE_KEY = "$file";

export type FileReference = { readonly [FILE_REFERENCE_KEY]: string };

/** Where references resolve: the project root, and the directory (relative to it) of the file holding them. */
export type FileReferenceContext = { readonly cwd: string; readonly baseDir: string };

type Path = ReadonlyArray<string | number>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A `{ "$file": "<path>" }` object and nothing else. */
export function isFileReference(value: unknown): value is FileReference {
  return (
    isPlainObject(value) &&
    Object.keys(value).length === 1 &&
    typeof value[FILE_REFERENCE_KEY] === "string"
  );
}

/** The absolute path a reference points at; E_VALIDATION when it leaves the project. */
export function resolveFileReference(context: FileReferenceContext, ref: string): string {
  const absolute = resolve(context.cwd, context.baseDir, ref);
  const rel = relative(context.cwd, absolute);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new ZitadelError("E_VALIDATION", `$file ${JSON.stringify(ref)} points outside the project`, {
      hint: "Keep referenced files inside the project, next to the file that references them.",
    });
  }
  return absolute;
}

/** Every reference in `document`, with the keys and indexes that lead to it. */
export function findFileReferences(document: unknown): Array<{ path: Path; ref: string }> {
  const found: Array<{ path: Path; ref: string }> = [];
  const walk = (node: unknown, path: Path): void => {
    if (isFileReference(node)) {
      found.push({ path, ref: node[FILE_REFERENCE_KEY] });
    } else if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, [...path, index]));
    } else if (isPlainObject(node)) {
      for (const [key, value] of Object.entries(node)) {
        walk(value, [...path, key]);
      }
    }
  };
  walk(document, []);
  return found;
}

/**
 * Returns a copy of `document` with every reference replaced by the content
 * of the file it points at. With `onMissing: "throw"` an unreadable file is
 * E_VALIDATION, which is what plan's gate wants; with `"omit"` the field is
 * dropped instead, so normalizing and hashing stay total.
 */
export function inlineFileReferences<T>(
  document: T,
  context: FileReferenceContext,
  options: { readonly onMissing: "throw" | "omit" },
): T {
  const inline = (node: unknown): unknown => {
    if (isFileReference(node)) {
      const ref = node[FILE_REFERENCE_KEY];
      const path = resolveFileReference(context, ref);
      try {
        return readFileSync(path, "utf8");
      } catch (error) {
        if (options.onMissing === "omit") {
          return undefined;
        }
        throw new ZitadelError("E_VALIDATION", `$file ${JSON.stringify(ref)} cannot be read`, {
          hint: "Create the referenced file or fix the path.",
          details: { cause: error instanceof Error ? error.message : String(error) },
        });
      }
    }
    if (Array.isArray(node)) {
      return node.map(inline);
    }
    if (isPlainObject(node)) {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node)) {
        const inlined = inline(value);
        if (inlined !== undefined) {
          out[key] = inlined;
        }
      }
      return out;
    }
    return node;
  };
  return inline(document) as T;
}

/**
 * Converts a canonical server document back to the local form. Wherever the
 * local document holds a reference and the canonical value at the same place
 * is a string, that string is written to the referenced file when it differs,
 * and the returned document carries the reference instead of the string.
 * `written` lists the references whose files changed.
 */
export function restoreFileReferences<T>(
  canonical: T,
  local: unknown,
  context: FileReferenceContext,
): { document: T; written: string[] } {
  const document = structuredClone(canonical) as unknown;
  const written: string[] = [];
  for (const { path, ref } of findFileReferences(local)) {
    const parent = path.slice(0, -1).reduce<unknown>(
      (node, key) => (isPlainObject(node) || Array.isArray(node) ? (node as never)[key] : undefined),
      document,
    );
    const key = path.at(-1);
    if (key === undefined || !(isPlainObject(parent) || Array.isArray(parent))) {
      continue;
    }
    const value = (parent as Record<string | number, unknown>)[key];
    if (typeof value !== "string") {
      continue;
    }
    const file = resolveFileReference(context, ref);
    let current: string | undefined;
    try {
      current = readFileSync(file, "utf8");
    } catch {
      current = undefined;
    }
    if (current !== value) {
      writeFileSync(file, value);
      written.push(ref);
    }
    (parent as Record<string | number, unknown>)[key] = { [FILE_REFERENCE_KEY]: ref };
  }
  return { document: document as T, written };
}
