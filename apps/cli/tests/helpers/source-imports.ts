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
  /** Whether the statement is `import type`, which leaves no trace at run time. */
  readonly typeOnly: boolean;
}

/**
 * Whether `found` is the one import a package may take from outside itself: a
 * type-only import of the shared error types, `@/lib/errors`, from the
 * package's own `errors.ts`.
 *
 * @param found - An import of a file under `layer`.
 * @param layer - The package's directory, relative to `src` (for example `lib/backend`).
 * @returns True for that import and nothing else.
 */
export function isOwnErrorsTypeImport(found: SourceImport, layer: string): boolean {
  return found.file === `${layer}/errors.ts` && found.target === "lib/errors" && found.typeOnly;
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
      const statement = source.lastIndexOf("import", match.index);
      imports.push({
        file: path,
        specifier,
        target: resolveFromSrc(path, specifier),
        typeOnly: source.startsWith("import type", statement),
      });
    }
  }
  return imports;
}
