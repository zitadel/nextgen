import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

type ReleasePackage = {
  buildTarget?: string;
  dir: string;
  moonProject?: string;
  name: string;
};

type ReleaseManifestModule = {
  PUBLIC_PACKAGE_BUILD_TARGETS: string[];
  PUBLIC_PACKAGE_DIRS: string[];
  PUBLIC_PACKAGE_NAMES: string[];
  PUBLIC_RELEASE_PACKAGES: ReleasePackage[];
};

const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
let manifest: ReleaseManifestModule;

beforeAll(async () => {
  manifest = (await import(
    new URL("../../../../../scripts/release-manifest.mjs", import.meta.url).href
  )) as ReleaseManifestModule;
});

describe("release manifest", () => {
  it("matches the Changesets fixed public package group", async () => {
    const config = JSON.parse(await readFile(join(repoRoot, ".changeset/config.json"), "utf8")) as {
      fixed: string[][];
    };

    expect(manifest.PUBLIC_PACKAGE_NAMES).toEqual(config.fixed[0]);
  });

  it("matches package.json names for every public package directory", async () => {
    for (const pkg of manifest.PUBLIC_RELEASE_PACKAGES) {
      const packageJson = JSON.parse(
        await readFile(join(repoRoot, pkg.dir, "package.json"), "utf8"),
      ) as { name: string };

      expect(packageJson.name).toBe(pkg.name);
    }
  });

  it("points every release build target at an existing Moon task", async () => {
    const workspace = await readFile(join(repoRoot, ".moon/workspace.yml"), "utf8");
    const packagesWithBuildTargets = manifest.PUBLIC_RELEASE_PACKAGES.filter(
      (candidate): candidate is ReleasePackage & { buildTarget: string; moonProject: string } =>
        Boolean(candidate.buildTarget),
    );

    for (const pkg of packagesWithBuildTargets) {
      const [project, task] = pkg.buildTarget.split(":");
      expect(project).toBe(pkg.moonProject);
      expect(manifest.PUBLIC_PACKAGE_BUILD_TARGETS).toContain(pkg.buildTarget);
      expect(workspace).toContain(`    ${project}: "${pkg.dir}"`);

      const moonConfig = await readFile(join(repoRoot, pkg.dir, "moon.yml"), "utf8");
      expect(moonConfig).toContain(`  ${task}:`);
    }
  });

  it("does not contain duplicate package metadata", () => {
    expect(new Set(manifest.PUBLIC_PACKAGE_NAMES).size).toBe(manifest.PUBLIC_PACKAGE_NAMES.length);
    expect(new Set(manifest.PUBLIC_PACKAGE_DIRS).size).toBe(manifest.PUBLIC_PACKAGE_DIRS.length);
    expect(new Set(manifest.PUBLIC_PACKAGE_BUILD_TARGETS).size).toBe(
      manifest.PUBLIC_PACKAGE_BUILD_TARGETS.length,
    );
  });
});
