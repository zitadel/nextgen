import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PackageJson } from "type-fest";

import { readIfExists } from "@/lib/fs";
import { parseJsonObject } from "@/lib/json";

import { PmManifestInvalidError } from "./errors";

/**
 * The shape of an npm `package.json`, as published by `type-fest`: `name`,
 * `version`, `scripts`, `dependencies`, `devDependencies`, `workspaces`,
 * `packageManager` and the rest of npm's documented fields, each with its
 * proper type.
 *
 * Re-exported so callers get the type and the readers from one place, and none
 * of them needs to write its own `{ dependencies?: Record<string, string> }`
 * cast.
 */
export type { PackageJson };

/**
 * A `package.json` that was read: the file that sits directly in one project
 * directory. It does not walk up to a parent, so a workspace package and its
 * root are read by passing each directory.
 */
export class Manifest {
  /** The parsed file. */
  readonly json: PackageJson;

  private constructor(json: PackageJson) {
    this.json = json;
  }

  /**
   * Reads and parses the `package.json` that sits directly in `dir`.
   *
   * This is the strict reader: a project that has no `package.json`, or whose
   * `package.json` cannot be parsed, is an error the caller is expected to deal
   * with or let propagate. Nothing is swallowed here. Callers that can carry on
   * without the file put `.catch(() => undefined)` on the call, or use
   * {@link Manifest.readIfExists} when only a missing file is acceptable.
   *
   * @param dir - The project directory that holds the `package.json`.
   * @returns The manifest.
   * @throws An `ENOENT` error when there is no `package.json` in `dir`, and a
   *   {@link PmManifestInvalidError} when the file is not valid JSON or its
   *   root is an array or a scalar.
   *
   * @example
   * const { json } = await Manifest.read(cwd);
   * const zitadel = Object.keys({ ...json.dependencies, ...json.devDependencies }).filter((name) =>
   *   name.startsWith("@zitadel/"),
   * );
   */
  static async read(dir: string): Promise<Manifest> {
    const path = join(dir, "package.json");
    const text = await readFile(path, "utf8");
    try {
      return new Manifest(parseJsonObject(text, path) as PackageJson);
    } catch (error) {
      throw new PmManifestInvalidError(path, {
        cause: error,
      });
    }
  }

  /**
   * Reads and parses the `package.json` in `dir`, treating a missing file as
   * "this directory is not an npm project" rather than as a failure.
   *
   * Use this when the absence of the file is a normal answer: detecting whether
   * a directory is a JavaScript project, or checking a freshly created
   * directory that has nothing in it yet. Only a missing file yields
   * `undefined`: a `package.json` that exists but is unreadable or corrupt
   * still throws, so a broken project is reported instead of being mistaken
   * for an empty directory.
   *
   * @param dir - The project directory that would hold the `package.json`.
   * @returns The manifest, or `undefined` when `dir` has no `package.json`.
   * @throws A {@link PmManifestInvalidError} when the file is not valid JSON or
   *   its root is not a JSON object, and any read error other than the file
   *   being absent (for example `EACCES` or `EISDIR`).
   */
  static async readIfExists(dir: string): Promise<Manifest | undefined> {
    const path = join(dir, "package.json");
    const text = await readIfExists(path);
    try {
      return text === undefined
        ? undefined
        : new Manifest(parseJsonObject(text, path) as PackageJson);
    } catch (error) {
      throw new PmManifestInvalidError(path, {
        cause: error,
      });
    }
  }
}
