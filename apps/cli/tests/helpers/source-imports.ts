import { posix } from "node:path";

/**
 * A static import that stays inside the package, as the capture group of each
 * match: relative (`./x`, `../x`) or through the `@/` alias for `src/`.
 */
export const LOCAL_IMPORT = /\bfrom\s+"((?:\.|@\/)[^"]*)"/g;

/**
 * Where `specifier`, imported by `file`, points, as a path relative to `src`
 * with the extension as written. `file` is a path relative to `src` too, in
 * the posix separator.
 */
export function resolveFromSrc(file: string, specifier: string): string {
  if (specifier.startsWith("@/")) {
    return posix.normalize(specifier.slice("@/".length));
  }
  return posix.normalize(posix.join(posix.dirname(file), specifier));
}
