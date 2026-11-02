/**
 * Local file references in `.zitadel/` resource files.
 *
 * Wherever the OpenAPI YAML marks a string field `x-local: file`, the
 * generated editor meta-schema accepts `{ "$file": "<path>" }` in its place,
 * so a long value such as a login template lives in its own file instead of a
 * JSON-escaped string. The API never sees a reference: before upload every
 * one is replaced by the referenced file's content.
 *
 * Resolution is generic. Nothing here knows which fields may carry a
 * reference; the Zod gate and the editor schema decide that.
 *
 * Paths are relative to the directory of the resource file that holds them
 * and must stay inside the project, because upload reads them. The check
 * applies to the real target: a symlink, or a symlinked directory on the way,
 * that leads outside the project is refused.
 */
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { isErrno, ZitadelError } from "./errors";

export const FILE_REFERENCE_KEY = "$file";

export type FileReference = { readonly [FILE_REFERENCE_KEY]: string };

/**
 * Where references resolve: the project root, and the directory (relative to
 * it) of the resource file holding them.
 */
export type FileReferenceContext = { readonly cwd: string; readonly baseDir: string };

/** The keys and indexes that lead from a document's root to one value. */
type Path = ReadonlyArray<string | number>;

const omittedReference = Symbol("omittedReference");

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A file's content, or undefined when it is absent. */
function readIfPresent(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (isErrno(error, "ENOENT") || isErrno(error, "ENOTDIR")) {
      return undefined;
    }
    throw error;
  }
}

function readFileReference(
  path: string,
  ref: string,
  options: { readonly onMissing: "throw" | "omit" },
): string | typeof omittedReference {
  let content: string | undefined;
  try {
    content = readIfPresent(path);
  } catch {
    throw new ZitadelError("E_VALIDATION", `$file ${JSON.stringify(ref)} cannot be read`, {
      hint: "Create the referenced file or fix the path.",
    });
  }
  if (content !== undefined) {
    return content;
  }
  if (options.onMissing === "omit") {
    return omittedReference;
  }
  throw new ZitadelError("E_VALIDATION", `$file ${JSON.stringify(ref)} cannot be read`, {
    hint: "Create the referenced file or fix the path.",
  });
}

/** Whether `path` is `root` itself or lies beneath it. */
function isWithin(root: string, path: string): boolean {
  const rel = relative(root, path);
  return !(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel));
}

/** Whether `path` itself is a symlink, without following it. */
function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * `path` with every symlink resolved, symlinked parent directories included,
 * even when its last segments do not exist yet. Undefined when a segment is a
 * symlink that resolves nowhere, since what it names could be anywhere.
 */
function realTarget(path: string): string | undefined {
  const missing: string[] = [];
  let current = path;
  for (;;) {
    try {
      return join(realpathSync(current), ...missing);
    } catch (error) {
      if (!isErrno(error, "ENOENT") && !isErrno(error, "ENOTDIR")) {
        throw error;
      }
      if (isSymlink(current)) {
        return undefined;
      }
      const parent = dirname(current);
      if (parent === current) {
        return path;
      }
      missing.unshift(basename(current));
      current = parent;
    }
  }
}

/** A `{ "$file": "<path>" }` object and nothing else. */
export function isFileReference(value: unknown): value is FileReference {
  return (
    isPlainObject(value) &&
    Object.keys(value).length === 1 &&
    typeof value[FILE_REFERENCE_KEY] === "string"
  );
}

/**
 * The absolute path a reference points at. E_VALIDATION when the path, or the
 * real target behind any symlink on the way, leaves the project.
 */
export function resolveFileReference(context: FileReferenceContext, ref: string): string {
  const absolute = resolve(context.cwd, context.baseDir, ref);
  const root = realTarget(resolve(context.cwd));
  const target = realTarget(absolute);
  const inside =
    isWithin(resolve(context.cwd), absolute) &&
    root !== undefined &&
    target !== undefined &&
    isWithin(root, target);
  if (!inside) {
    throw new ZitadelError(
      "E_VALIDATION",
      `$file ${JSON.stringify(ref)} points outside the project`,
      {
        hint:
          "Keep referenced files inside the project, next to the file that references them; " +
          "a symlink on the way must resolve inside the project too.",
      },
    );
  }
  return absolute;
}

/** Every reference in `document`, with the path that leads to it. */
export function findFileReferences(document: unknown): Array<{ path: Path; ref: string }> {
  const found: Array<{ path: Path; ref: string }> = [];
  const walk = (node: unknown, path: Path): void => {
    if (isFileReference(node)) {
      found.push({ path, ref: node[FILE_REFERENCE_KEY] });
    } else if (Array.isArray(node)) {
      node.forEach((item, index) => {
        walk(item, [...path, index]);
      });
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
 * E_VALIDATION, which is what plan's gate wants; with `"omit"` the value is
 * dropped instead (the key from an object, the element from an array), so
 * normalizing and hashing stay total. A path leaving the project is always
 * E_VALIDATION.
 */
export function inlineFileReferences<T>(
  document: T,
  context: FileReferenceContext,
  options: { readonly onMissing: "throw" | "omit" },
): T {
  const inline = (node: unknown): unknown => {
    if (isFileReference(node)) {
      const ref = node[FILE_REFERENCE_KEY];
      return readFileReference(resolveFileReference(context, ref), ref, options);
    }
    if (Array.isArray(node)) {
      return node.map(inline).filter((item) => item !== omittedReference);
    }
    if (isPlainObject(node)) {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node)) {
        const inlined = inline(value);
        if (inlined !== omittedReference) {
          out[key] = inlined;
        }
      }
      return out;
    }
    return node;
  };
  return inline(document) as T;
}
