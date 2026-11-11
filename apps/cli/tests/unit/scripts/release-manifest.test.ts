import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { supportedPlatforms } from "@zitadel/server/binary";
import { describe, expect, it } from "vitest";

type ReleasePackage = {
  buildTarget?: string;
  dir: string;
  moonProject?: string;
  name: string;
};

type ReleaseManifestModule = {
  APP_RELEASE_PACKAGES: ReleasePackage[];
  SERVER_PLATFORM_PACKAGES: Array<{ packageName: string; packageDir: string }>;
  hostServerPlatformPackage: (
    platform?: string,
    arch?: string,
  ) => { packageName: string; packageDir: string };
  hostOnlyPackageDirs: (host?: { packageDir: string }) => string[];
  PUBLIC_PACKAGE_BUILD_TARGETS: string[];
  PUBLIC_PACKAGE_DIRS: string[];
  PUBLIC_PACKAGE_NAMES: string[];
  PUBLIC_RELEASE_PACKAGES: ReleasePackage[];
};

const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const manifest = (await import(
  new URL("../../../../../scripts/release-manifest.mjs", import.meta.url).href
)) as ReleaseManifestModule;

describe("release manifest", () => {
  it("releases exactly the platform packages the server resolves its binary from", () => {
    expect(manifest.SERVER_PLATFORM_PACKAGES.map((entry) => entry.packageName).sort()).toEqual(
      supportedPlatforms.map((entry) => entry.packageName).sort(),
    );
  });

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

  it("gives a generated app every @zitadel package its SDKs depend on", async () => {
    const appNames = new Set(manifest.APP_RELEASE_PACKAGES.map((pkg) => pkg.name));
    expect(appNames).toContain("@zitadel/sdk-next");
    expect(appNames).not.toContain("@zitadel/cli");
    expect(appNames).not.toContain("@zitadel/server");
    expect(appNames).not.toContain("@zitadel/testing");

    for (const pkg of manifest.APP_RELEASE_PACKAGES) {
      // The wrapper builds each one through its moon `build` task.
      expect(pkg.moonProject).toBeTruthy();
      const packageJson = JSON.parse(
        await readFile(join(repoRoot, pkg.dir, "package.json"), "utf8"),
      ) as Record<string, Record<string, string> | undefined>;
      for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
        for (const name of Object.keys(packageJson[field] ?? {})) {
          if (name.startsWith("@zitadel/")) {
            expect(appNames, `${pkg.name} ${field}`).toContain(name);
          }
        }
      }
    }
  });

  it("maps each platform the server supports to the package its binary comes from", () => {
    for (const entry of supportedPlatforms) {
      expect(manifest.hostServerPlatformPackage(entry.platform, entry.arch).packageName).toBe(
        entry.packageName,
      );
    }
    expect(() => manifest.hostServerPlatformPackage("freebsd", "x64")).toThrow(
      "no server platform package for freebsd-x64",
    );
  });

  it("keeps only the host's server platform package in a host-only snapshot", () => {
    const host = manifest.hostServerPlatformPackage("linux", "x64");
    const others = manifest.SERVER_PLATFORM_PACKAGES.filter((entry) => entry !== host).map(
      (entry) => entry.packageDir,
    );

    expect(manifest.hostOnlyPackageDirs(host)).toEqual(
      manifest.PUBLIC_PACKAGE_DIRS.filter((dir) => !others.includes(dir)),
    );
    expect(manifest.hostOnlyPackageDirs(host)).toContain(host.packageDir);
    expect(manifest.hostOnlyPackageDirs(host)).toHaveLength(
      manifest.PUBLIC_PACKAGE_DIRS.length - others.length,
    );
  });

  it("does not contain duplicate package metadata", () => {
    expect(new Set(manifest.PUBLIC_PACKAGE_NAMES).size).toBe(manifest.PUBLIC_PACKAGE_NAMES.length);
    expect(new Set(manifest.PUBLIC_PACKAGE_DIRS).size).toBe(manifest.PUBLIC_PACKAGE_DIRS.length);
    expect(new Set(manifest.PUBLIC_PACKAGE_BUILD_TARGETS).size).toBe(
      manifest.PUBLIC_PACKAGE_BUILD_TARGETS.length,
    );
  });
});
