import picomatch from "picomatch";

/**
 * Whether `path` (relative, with forward slashes) matches any of `globs`. Dotfiles match, like a
 * test or story file named `.x.test.ts` should.
 */
export function matchesAnyGlob(path: string, globs: readonly string[]): boolean {
  return globs.length > 0 && picomatch([...globs], { dot: true })(path);
}
