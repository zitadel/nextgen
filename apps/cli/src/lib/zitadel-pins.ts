import semver from "semver";

import { readPackageJsonIfExists } from "@/lib/npm";

/**
 * A `@zitadel/*` dependency of a project: its package name and the specifier
 * its `package.json` gives it.
 */
type ZitadelSpec = [name: string, specifier: string];

/**
 * The `@zitadel/*` dependencies `package.json` pins to an exact version.
 *
 * @remarks
 * Ranges, dist-tags and `file:`/`workspace:` specifiers are left out: they
 * express a resolution choice, not a train.
 *
 * @param cwd - The project directory.
 * @returns The pins as `[name, version]`, or undefined without a `package.json`.
 * @throws A `SyntaxError` when the `package.json` is not valid JSON.
 */
export async function exactZitadelPins(cwd: string): Promise<ZitadelSpec[] | undefined> {
  return (await zitadelSpecs(cwd))?.filter(([, version]) => semver.valid(version) !== null);
}

/**
 * The `@zitadel/*` dependencies {@link exactZitadelPins} leaves out.
 *
 * @param cwd - The project directory.
 * @returns The dependencies as `[name, specifier]`, or undefined without a
 * `package.json`.
 * @throws A `SyntaxError` when the `package.json` is not valid JSON.
 */
export async function floatingZitadelSpecs(cwd: string): Promise<ZitadelSpec[] | undefined> {
  return (await zitadelSpecs(cwd))?.filter(([, version]) => semver.valid(version) === null);
}

/**
 * Every `@zitadel/*` dependency and dev dependency of the project.
 *
 * @param cwd - The project directory.
 * @returns They as `[name, trimmed specifier]`, or undefined without a
 * `package.json`.
 * @throws A `SyntaxError` when the `package.json` is not valid JSON.
 */
async function zitadelSpecs(cwd: string): Promise<ZitadelSpec[] | undefined> {
  const pkg = await readPackageJsonIfExists(cwd);
  return (
    pkg &&
    Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })
      .filter(([name]) => name.startsWith("@zitadel/"))
      .map(([name, version]): ZitadelSpec => [name, (version ?? "").trim()])
  );
}
