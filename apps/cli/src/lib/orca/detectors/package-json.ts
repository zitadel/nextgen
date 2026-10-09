import { readFile } from "node:fs/promises";
import { join } from "node:path";

import semver from "semver";

/**
 * Minimal shape of the `package.json` fields detectors read. Intentionally
 * partial: only the keys detection logic depends on are modeled, all optional
 * since a project may omit any of them.
 */
export type PackageJson = {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

/**
 * Reads and parses the `package.json` at `cwd`. Rejects if the file is absent
 * or malformed; callers that treat those as "not a project" are expected to
 * catch and fall back rather than have detection swallow the error here.
 */
export async function readPackageJson(cwd: string): Promise<PackageJson> {
  const contents = await readFile(join(cwd, "package.json"), "utf8");
  return JSON.parse(contents) as PackageJson;
}

/**
 * Reports whether `name` appears in either `dependencies` or `devDependencies`.
 * Both are checked because framework packages may legitimately live in either.
 */
export function hasDependency(pkg: PackageJson, name: string): boolean {
  return Boolean(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]);
}

/**
 * Best-effort major version of a declared dependency: the first number in the
 * spec. A heuristic for scaffold decisions (e.g. which Next request-boundary
 * convention to emit), NOT for support gating — range semantics like `<16`
 * are beyond it. Floors use {@link dependencySpecProvablyBelowMajor}.
 */
export function dependencyVersionMajor(pkg: PackageJson, name: string): number | undefined {
  const spec = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
  if (!spec) {
    return undefined;
  }
  const match = spec.match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

/**
 * Returns the declared spec for `name` when that spec provably cannot resolve
 * to `floorMajor` or newer: a valid semver range with no overlap with
 * `>=floorMajor.0.0-0`. Everything unprovable returns `undefined` — protocol
 * specs (`file:`, `link:`, `workspace:`, git URLs), dist-tags (`latest`,
 * `canary`), absent deps, and ranges that also admit a compliant version
 * (`>=14`, `14 || 16`). The floor comparator includes prereleases so a
 * `15.0.0-rc` user is not rejected by the 15 floor.
 */
export function dependencySpecProvablyBelowMajor(
  pkg: PackageJson,
  name: string,
  floorMajor: number,
): string | undefined {
  const spec = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
  if (!spec || semver.validRange(spec) === null) {
    return undefined;
  }
  const atOrAboveFloor = `>=${String(floorMajor)}.0.0-0`;
  return semver.intersects(spec, atOrAboveFloor, { includePrerelease: true }) ? undefined : spec;
}
