import { readFileSync } from "node:fs";
import { join } from "node:path";

// @boundaries-ignore root scripts/ belongs to the workspace root, which no package can depend on
import { PUBLIC_RELEASE_PACKAGES } from "../../../scripts/release-manifest.mjs";
import { ciJourneyVariants, frameworkForId } from "./frameworks.mjs";

const RUNTIME_DEPENDENCY_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies"];

/**
 * The public release packages the given journeys install: the CLI (and
 * through it the server and every platform package), each framework's SDK,
 * and the test kit for the testkit suite, with every public package those
 * depend on at runtime. A journey's registry serves only these, and it never
 * proxies `@zitadel/*` to npmjs, so one missing here fails the install.
 */
export function journeyPackageDirs(repoRoot, runs, read = readFileSync) {
  const dirByName = new Map(PUBLIC_RELEASE_PACKAGES.map((pkg) => [pkg.name, pkg.dir]));
  const pending = ["apps/cli"];
  for (const { variant, framework } of runs) {
    pending.push(framework.sdkPackageDir);
    if (variant.suite === "testkit") pending.push("packages/testing");
  }
  const dirs = new Set();
  while (pending.length > 0) {
    const dir = pending.pop();
    if (dirs.has(dir)) continue;
    dirs.add(dir);
    const manifest = JSON.parse(read(join(repoRoot, dir, "package.json"), "utf8"));
    for (const field of RUNTIME_DEPENDENCY_FIELDS) {
      for (const name of Object.keys(manifest[field] ?? {})) {
        const dependency = dirByName.get(name);
        if (dependency) pending.push(dependency);
      }
    }
  }
  return [...dirs].sort();
}

/**
 * What every CI journey installs: the CLI, the packages every SDK depends on,
 * and theirs. The `journey-packages` task packs them once for all journeys
 * (pack-shared-packages.mjs); its task depends on their builds.
 */
export function sharedPackageDirs(repoRoot, read = readFileSync) {
  const sets = ciJourneyVariants().flatMap((variant) =>
    variant.frameworkIds.map(
      (id) =>
        new Set(journeyPackageDirs(repoRoot, [{ variant, framework: frameworkForId(id) }], read)),
    ),
  );
  return [...sets[0]].filter((dir) => sets.every((set) => set.has(dir))).sort();
}

/** Where the `journey-packages` task leaves the shared tarballs. */
export function sharedPackagesDir(repoRoot) {
  return join(repoRoot, "e2e", "journey", "test-output", "npm-packages");
}

/**
 * The turbo tasks that build what those packages ship, which a journey task
 * depends on: a platform package's binary, the server package's nothing (it
 * ships its launcher as source), every other package's `build`.
 */
export function journeyBuildTasks(dirs) {
  const nameByDir = new Map(PUBLIC_RELEASE_PACKAGES.map((pkg) => [pkg.dir, pkg.name]));
  return dirs
    .filter((dir) => dir !== "apps/server")
    .map((dir) =>
      dir.startsWith("apps/server-")
        ? `${nameByDir.get(dir)}#build-binary`
        : `${nameByDir.get(dir)}#build`,
    )
    .sort();
}
