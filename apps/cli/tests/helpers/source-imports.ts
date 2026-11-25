import { readdir, readFile } from "node:fs/promises";
import { join, posix, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A static import that stays inside the package, as the capture group of each
 * match: relative (`./x`, `../x`) or through the `@/` alias for `src/`.
 */
export const LOCAL_IMPORT = /\bfrom\s+"((?:\.|@\/)[^"]*)"/g;

/**
 * The `src` directory of the package, as a path on disk.
 */
const SRC = fileURLToPath(new URL("../../src", import.meta.url));

/**
 * One static local import of a source file.
 */
export interface SourceImport {
  /** The importing file, relative to `src`, in the posix separator. */
  readonly file: string;
  /** The import as written. */
  readonly specifier: string;
  /** Where it points, relative to `src`, with the extension as written. */
  readonly target: string;
}

/**
 * Where `specifier`, imported by `file`, points, as a path relative to `src`
 * with the extension as written. `file` is a path relative to `src` too, in
 * the posix separator.
 *
 * @param file - The importing file, relative to `src`.
 * @param specifier - The import as written.
 * @returns The path the import points at, relative to `src`.
 */
export function resolveFromSrc(file: string, specifier: string): string {
  if (specifier.startsWith("@/")) {
    return posix.normalize(specifier.slice("@/".length));
  }
  return posix.normalize(posix.join(posix.dirname(file), specifier));
}

/**
 * Every static local import of every `.ts` file under `layer`, resolved
 * against `src` so a relative path and the `@/` alias compare the same way.
 *
 * @param layer - The directory to walk, relative to `src`, in the posix
 *   separator (for example `lib/backend`).
 * @returns The imports, each with the file that holds it.
 */
export async function importsUnder(layer: string): Promise<readonly SourceImport[]> {
  const files = (await readdir(join(SRC, layer), { recursive: true })).filter((file) => {
    return file.endsWith(".ts");
  });
  const imports: SourceImport[] = [];
  for (const file of files) {
    const path = posix.join(layer, file.split(sep).join(posix.sep));
    const source = await readFile(join(SRC, path), "utf8");
    for (const match of source.matchAll(LOCAL_IMPORT)) {
      const specifier = match[1];
      if (specifier === undefined) {
        continue;
      }
      imports.push({ file: path, specifier, target: resolveFromSrc(path, specifier) });
    }
  }
  return imports;
}
