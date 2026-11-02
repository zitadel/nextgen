import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { PackageJson } from "type-fest";

import { readIfExists } from "./fs";
import { parseJsonObject } from "./json";

export type { PackageJson };

/** The `package.json` in `dir`. A file that is missing or is not a JSON object throws. */
export async function readPackageJson(dir: string): Promise<PackageJson> {
  const path = join(dir, "package.json");
  return parseJsonObject(await readFile(path, "utf8"), path) as PackageJson;
}

/**
 * The `package.json` in `dir`, or `undefined` when there is none. One that
 * exists but is not a JSON object still throws.
 */
export async function readPackageJsonIfExists(dir: string): Promise<PackageJson | undefined> {
  const path = join(dir, "package.json");
  const text = await readIfExists(path);
  return text === undefined ? undefined : (parseJsonObject(text, path) as PackageJson);
}
