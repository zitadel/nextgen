import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { renderLanding } from "../src/landing.js";

/**
 * Dependency field names a workspace package may declare a sibling
 * package under. Any `workspace:` protocol value in these fields (eg
 * `workspace:*`, `workspace:^`, `workspace:~`) is rewritten to the
 * concrete snapshot version during the publish pass.
 */
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/** Absolute path to `apps/preview-registry/`. */
const APP_ROOT = resolve(import.meta.dirname, "..");

/** Absolute path to the workspace root that owns `packages/*`. */
const REPO_ROOT = resolve(APP_ROOT, "..", "..");

/** Output directory the function bundle ships via `vercel.json#functions.includeFiles`. */
const SNAPSHOT_ROOT = join(APP_ROOT, ".snapshots");

/** Short commit identifier baked into every published snapshot version. */
const commitSha = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7);

/** SemVer pre-release tag every workspace package is republished under for this deploy. */
const SNAPSHOT_VERSION = `0.0.0-sha-${commitSha || "localdev"}`;

/**
 * Snapshot of the on-disk state of a single `package.json` file, kept
 * so the file can be restored verbatim after the publish pass finishes.
 */
interface StampedPackage {
  readonly packageJsonPath: string;
  readonly originalContent: string;
  readonly name: string;
}

interface MutablePackageJson {
  name: string;
  version: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Discover every workspace package directory under `packages/` that is
 * suitable to publish to the preview registry.
 *
 * Skips directories that are not real packages (missing
 * `package.json`) and packages flagged `private: true` — those exist
 * only for internal workspace consumption and would refuse to publish
 * to a real npm registry anyway.
 */
const listPackageDirectories = (): readonly string[] =>
  readdirSync(join(REPO_ROOT, "packages"))
    .map((entry) => `packages/${entry}`)
    .filter((path) => {
      try {
        const packageJsonPath = join(REPO_ROOT, path, "package.json");
        if (!readdirSync(join(REPO_ROOT, path)).includes("package.json")) {
          return false;
        }
        const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8")) as MutablePackageJson;
        return manifest.private !== true;
      } catch {
        return false;
      }
    });

/**
 * Rewrite a single `package.json` in place: bump its version to the
 * deploy's snapshot version and replace every `workspace:` protocol
 * dependency value (`workspace:*`, `workspace:^`, `workspace:~`, …)
 * with the same snapshot version.
 *
 * Returns a {@link StampedPackage} containing the file's original
 * content so {@link restoreOriginals} can put it back afterwards.
 */
const stampPackage = (packageDirectory: string): StampedPackage => {
  const packageJsonPath = join(REPO_ROOT, packageDirectory, "package.json");
  const originalContent = readFileSync(packageJsonPath, "utf8");
  const manifest = JSON.parse(originalContent) as MutablePackageJson;

  manifest.version = SNAPSHOT_VERSION;
  for (const field of DEPENDENCY_FIELDS) {
    const deps = manifest[field];
    if (!deps) continue;
    for (const [dependencyName, value] of Object.entries(deps)) {
      if (typeof value === "string" && value.startsWith("workspace:")) {
        deps[dependencyName] = SNAPSHOT_VERSION;
      }
    }
  }

  writeFileSync(packageJsonPath, JSON.stringify(manifest, null, 2) + "\n");
  return {
    packageJsonPath,
    originalContent,
    name: manifest.name,
  };
};

/**
 * Restore every stamped `package.json` to the bytes that were on disk
 * before {@link stampPackage} rewrote it.
 */
const restoreOriginals = (stamped: readonly StampedPackage[]): void => {
  for (const { packageJsonPath, originalContent } of stamped) {
    writeFileSync(packageJsonPath, originalContent);
  }
};

/**
 * Filename prefix pnpm uses for a packed tarball of `packageName`.
 * `@scope/name` → `scope-name-`, so `scope-name-1.0.0.tgz` matches it.
 */
const tarballPrefixFor = (packageName: string): string =>
  packageName.replace("@", "").replace("/", "-") + "-";

/**
 * Pack every workspace package and copy each resulting tarball into
 * the snapshot bundle the Vercel function ships.
 *
 * Runs as the second half of `vercel.json`'s `buildCommand`. The
 * function bundle includes `.snapshots/**` via `vercel.json#functions`,
 * so once this script finishes the snapshots are already in place for
 * the deploy that follows.
 */
const publishOnDeploy = async (): Promise<void> => {
  rmSync(SNAPSHOT_ROOT, { recursive: true, force: true });

  const stagingDirectory = mkdtempSync(join(tmpdir(), "publish-on-deploy-"));
  // Collect stamped packages incrementally so a failure mid-pack still
  // lets `finally` restore every package.json that was already stamped,
  // rather than leaving them modified on disk.
  const stamped: StampedPackage[] = [];
  try {
    for (const packageDirectory of listPackageDirectories()) {
      const entry = stampPackage(packageDirectory);
      stamped.push(entry);
      console.log(`packing ${packageDirectory} → ${entry.name}@${SNAPSHOT_VERSION}`);
      execFileSync("corepack", ["pnpm", "pack", "--pack-destination", stagingDirectory], {
        cwd: join(REPO_ROOT, packageDirectory),
        stdio: "inherit",
      });
    }

    const bundled = readdirSync(stagingDirectory)
      .filter((file) => file.endsWith(".tgz"))
      .reduce<readonly { name: string; version: string; sizeBytes: number }[]>(
        (accumulator, tarballFile) => {
          const matched = stamped.find((entry) =>
            tarballFile.startsWith(tarballPrefixFor(entry.name)),
          );
          if (!matched) {
            console.warn(`skip ${tarballFile} — no matching workspace package`);
            return accumulator;
          }
          const tarballBody = readFileSync(join(stagingDirectory, tarballFile));
          const destination = join(SNAPSHOT_ROOT, matched.name, "-", tarballFile);
          mkdirSync(resolve(destination, ".."), { recursive: true });
          writeFileSync(destination, tarballBody);
          console.log(`bundled ${matched.name}@${SNAPSHOT_VERSION}`);
          return [
            ...accumulator,
            {
              name: matched.name,
              version: SNAPSHOT_VERSION,
              sizeBytes: tarballBody.length,
            },
          ];
        },
        [],
      );

    const manifestPath = join(APP_ROOT, "src", "snapshot-manifest.ts");
    const manifestSource =
      "// AUTO-GENERATED by scripts/publish-on-deploy.ts. Do not edit.\n" +
      "import type { PackageRow } from './landing.js'\n\n" +
      "export const SNAPSHOT_PACKAGES: readonly PackageRow[] = " +
      JSON.stringify(bundled, null, 2) +
      " as const\n";
    writeFileSync(manifestPath, manifestSource);

    const publicDirectory = join(APP_ROOT, "public");
    mkdirSync(publicDirectory, { recursive: true });
    const isProduction = process.env.VERCEL_ENV === "production";
    const canonicalHost = isProduction
      ? (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL)
      : (process.env.VERCEL_BRANCH_URL ?? process.env.VERCEL_URL);
    const origin = canonicalHost ? `https://${canonicalHost}` : "http://localhost:3000";
    const branch = process.env.VERCEL_GIT_COMMIT_REF ?? "main";
    writeFileSync(join(publicDirectory, "index.html"), renderLanding(bundled, origin, branch));

    console.log(
      `\nbundled ${bundled.length} snapshot(s) into ${SNAPSHOT_ROOT}, wrote manifest ${manifestPath}, wrote public/index.html`,
    );
  } finally {
    restoreOriginals(stamped);
    rmSync(stagingDirectory, { recursive: true, force: true });
  }
};

await publishOnDeploy();
