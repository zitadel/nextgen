import { readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

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
 * to `floorMajor` or newer. Shorthand for {@link dependencySpecProvablyBelow}
 * with a whole-major floor.
 */
export function dependencySpecProvablyBelowMajor(
  pkg: PackageJson,
  name: string,
  floorMajor: number,
): string | undefined {
  return dependencySpecProvablyBelow(pkg, name, String(floorMajor));
}

/**
 * Returns the declared spec for `name` when that spec provably cannot resolve
 * to `minimum` (a version such as `15` or `15.2.3`) or newer: a valid semver
 * range with no overlap with `>=minimum-0`. Everything unprovable returns
 * `undefined` — protocol specs (`file:`, `link:`, `workspace:`, git URLs),
 * dist-tags (`latest`, `canary`), absent deps, and ranges that also admit a
 * compliant version (`>=14`, `14 || 16`, `^15.0.0` for `15.2.3`). A range
 * that explicitly names a prerelease at or above the floor (`15.0.0-rc.0`,
 * `16.0.0-rc.1` for the 15 floor) is not rejected; ranges like `<15.2.3`
 * resolve no prerelease of it.
 */
export function dependencySpecProvablyBelow(
  pkg: PackageJson,
  name: string,
  minimum: string,
): string | undefined {
  const spec = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
  const floor = semver.coerce(minimum);
  if (!spec || !floor || semver.validRange(spec) === null) {
    return undefined;
  }
  if (semver.intersects(spec, `>=${floor.version}`)) {
    return undefined;
  }
  return declaresPrereleaseAtOrAbove(spec, floor) ? undefined : spec;
}

/**
 * Whether `spec` explicitly admits a prerelease whose base version is at or
 * above the floor (`15.3.0-canary.1`, `16.0.0-rc.1`, `15.0.0-rc.0` for a 15
 * floor). npm resolves prereleases only for a range that spells one out, so
 * only a comparator naming one can install it, and only if the range accepts
 * that very version.
 */
function declaresPrereleaseAtOrAbove(spec: string, floor: semver.SemVer): boolean {
  return new semver.Range(spec).set.some((comparators) =>
    comparators.some(({ semver: version, operator }) => {
      // semver rewrites `<15.2.3` to `<15.2.3-0`; that is no declared prerelease.
      if (
        version.prerelease.length === 0 ||
        (operator === "<" && version.prerelease.join(".") === "0")
      ) {
        return false;
      }
      const base = `${version.major}.${version.minor}.${version.patch}`;
      return (
        semver.gte(base, floor) && semver.satisfies(version, spec, { includePrerelease: true })
      );
    }),
  );
}

/**
 * The version of `name` installed for the app at `cwd`: the `package.json` that
 * Node's own lookup reaches first, walking up from `cwd` through each
 * `node_modules`, so a hoisted install in a monorepo counts too. `undefined`
 * when nothing is installed there, or the file names no valid version.
 */
export async function installedVersion(cwd: string, name: string): Promise<string | undefined> {
  let dir = await realpath(resolve(cwd)).catch(() => resolve(cwd));
  for (;;) {
    const contents = await readFile(join(dir, "node_modules", name, "package.json"), "utf8").catch(
      () => undefined,
    );
    if (contents !== undefined) {
      return versionIn(contents);
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/** The valid semver `version` a `package.json` declares, if any. */
function versionIn(contents: string): string | undefined {
  try {
    const { version } = JSON.parse(contents) as { version?: unknown };
    return typeof version === "string" ? (semver.valid(version) ?? undefined) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Returns the installed version of `name` for the app at `cwd` when it is older
 * than `minimum`. A range such as `^15.0.0` passes {@link dependencySpecProvablyBelow}
 * because it can resolve to a supported release, but the lockfile may still hold
 * an older one; this judges what actually runs. Nothing installed returns
 * `undefined`, leaving the declared spec as the only gate. A prerelease of the
 * floor itself is not below it, as for the spec.
 */
export async function installedVersionBelow(
  cwd: string,
  name: string,
  minimum: string,
): Promise<string | undefined> {
  const installed = await installedVersion(cwd, name);
  const floor = semver.coerce(minimum);
  if (installed === undefined || !floor || !semver.lt(installed, `${floor.version}-0`)) {
    return undefined;
  }
  return installed;
}
