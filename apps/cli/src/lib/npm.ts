import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PackageJson } from "type-fest";

import { readIfExists } from "./fs";
import { parseJsonObject } from "./json";

/**
 * The shape of an npm `package.json`, as published by `type-fest`: `name`,
 * `version`, `scripts`, `dependencies`, `devDependencies`, `workspaces`,
 * `packageManager` and the rest of npm's documented fields, each with its
 * proper type.
 *
 * Re-exported here so callers get the type and the readers below from one
 * place, and none of them needs to write its own
 * `{ dependencies?: Record<string, string> }` cast.
 */
export type { PackageJson };

/**
 * Reads and parses the `package.json` that sits directly in `dir`.
 *
 * This is the strict reader: a project that has no `package.json`, or whose
 * `package.json` cannot be parsed, is an error the caller is expected to deal
 * with or let propagate. Nothing is swallowed here. Callers that can carry on
 * without the file put `.catch(() => undefined)` on the call, or use
 * {@link readPackageJsonIfExists} when only a missing file is acceptable.
 *
 * Only `dir` itself is looked at. It does not walk up to a parent directory,
 * so a workspace package and its root are read by passing each directory.
 *
 * @param dir The project directory that holds the `package.json`.
 * @returns The parsed file, typed as {@link PackageJson}.
 * @throws An `ENOENT` error when there is no `package.json` in `dir`, a
 * `SyntaxError` when the file is not valid JSON, and an `Error` naming the file
 * ("... must contain a JSON object") when its root is an array or a scalar.
 *
 * @example
 * const pkg = await readPackageJson(cwd);
 * const zitadel = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((name) =>
 *   name.startsWith("@zitadel/"),
 * );
 */
export async function readPackageJson(dir: string): Promise<PackageJson> {
  const path = join(dir, "package.json");
  return parseJsonObject(await readFile(path, "utf8"), path) as PackageJson;
}

/**
 * Reads and parses the `package.json` in `dir`, treating a missing file as
 * "this directory is not an npm project" rather than as a failure.
 *
 * Use this when the absence of the file is a normal answer: detecting whether a
 * directory is a JavaScript project, or checking a freshly created directory
 * that has nothing in it yet. The distinction matters because the two cases are
 * kept apart: only a missing file yields `undefined`. A `package.json` that
 * exists but is unreadable or corrupt still throws, so a broken project is
 * reported instead of being mistaken for an empty directory.
 *
 * @param dir The project directory that would hold the `package.json`.
 * @returns The parsed file typed as {@link PackageJson}, or `undefined` when
 * `dir` has no `package.json`.
 * @throws A `SyntaxError` when the file is not valid JSON, an `Error` naming the
 * file when its root is not a JSON object, and any read error other than the
 * file being absent (for example `EACCES` or `EISDIR`).
 *
 * @example
 * const pkg = await readPackageJsonIfExists(cwd);
 * if (pkg === undefined) {
 *   return "not an npm project";
 * }
 */
export async function readPackageJsonIfExists(dir: string): Promise<PackageJson | undefined> {
  const path = join(dir, "package.json");
  const text = await readIfExists(path);
  return text === undefined ? undefined : (parseJsonObject(text, path) as PackageJson);
}
