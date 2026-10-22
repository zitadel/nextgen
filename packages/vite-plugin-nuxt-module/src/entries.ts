import { resolve } from "node:path";

/** Entry files, listed (each named after its file) or as an `{ outputName: file }` map (names may contain `/`). */
export type EntryOption = readonly string[] | Readonly<Record<string, string>>;

/** The output name of an entry listed by file: its file name without directory or extension. */
export function entryName(file: string): string {
  return file.replace(/^.*\/|\.[^.]+$/g, "");
}

/**
 * Every entry by output name: a listed file is named after its file name, a map keeps its names.
 * Two listed files with the same name (`a/index.ts`, `b/index.ts`) would write one output: that
 * fails, pointing at the `{ name: file }` form.
 */
export function namedEntries(entry: EntryOption): Record<string, string> {
  if (!isEntryList(entry)) return { ...entry };
  const named: Record<string, string> = {};
  for (const file of entry) {
    const name = entryName(file);
    const taken = named[name];
    if (taken !== undefined)
      throw new Error(
        `entry: ${taken} and ${file} are both named "${name}"; name them with the { name: file } form`,
      );
    named[name] = file;
  }
  return named;
}

/**
 * `path` with forward slashes: how Vite and Rolldown spell module ids on every platform, so a path
 * built with `node:path` (backslashes on Windows) compares equal to the id of the same file.
 */
export function posixPath(path: string): string {
  return path.replace(/\\/g, "/");
}

/** The same entries with their files resolved against `root`, spelled like Vite's module ids. */
export function resolvedEntries(
  entries: Readonly<Record<string, string>>,
  root: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(entries).map(([name, file]) => [name, posixPath(resolve(root, file))]),
  );
}

function isEntryList(entry: EntryOption): entry is readonly string[] {
  return Array.isArray(entry);
}
