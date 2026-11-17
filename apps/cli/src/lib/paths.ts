import { dirname, resolve } from "node:path";

/**
 * Resolve the working directory the CLI should operate against, defaulting to
 * the process CWD when no `--cwd` override is given. Always returns an
 * absolute path so downstream `join`/`readFile` calls are unaffected by later
 * `process.chdir` or relative-path ambiguity.
 */
export function resolveCwd(cwd?: string): string {
  return resolve(cwd ?? process.cwd());
}

/**
 * The directories to look in when searching upward from `path`: `path` itself,
 * then its parent, then that directory's parent, and so on, nearest first.
 *
 * The walk ends at `stopAt` when it is given (and `stopAt` is included, so the
 * boundary directory is still searched) or at the filesystem root. If `stopAt`
 * is not an ancestor of `path`, the walk simply runs to the root.
 *
 * Returning the whole list up front lets callers write the search as a plain
 * `for (const dir of ancestors(cwd))` loop with early returns, without a
 * cursor variable that moves up one level on each pass. The list is as long as
 * the directory is deep, a few dozen entries at most.
 *
 * @param path The directory to start from.
 * @param stopAt The last directory to include. Defaults to the filesystem root.
 * @returns `path` and its ancestors, nearest first, ending at `stopAt` or the root.
 *
 * @example
 * ancestors("/a/b/c"); // ["/a/b/c", "/a/b", "/a", "/"]
 * ancestors("/a/b/c", "/a/b"); // ["/a/b/c", "/a/b"]
 */
export function ancestors(path: string, stopAt?: string): string[] {
  const parent = dirname(path);
  return path === stopAt || parent === path ? [path] : [path, ...ancestors(parent, stopAt)];
}
