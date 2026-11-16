import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { supportedPlatforms } from "@zitadel/server/binary";
import { describe, expect, it } from "vitest";

type ReleasePackage = {
  dir: string;
  name: string;
};

type ReleaseManifestModule = {
  APP_RELEASE_PACKAGES: ReleasePackage[];
  SERVER_PLATFORM_PACKAGES: Array<{ packageName: string; packageDir: string }>;
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

  it("gives a generated app every @zitadel package its SDKs depend on", async () => {
    const appNames = new Set(manifest.APP_RELEASE_PACKAGES.map((pkg) => pkg.name));
    expect(appNames).toContain("@zitadel/sdk-next");
    expect(appNames).not.toContain("@zitadel/cli");
    expect(appNames).not.toContain("@zitadel/server");
    expect(appNames).not.toContain("@zitadel/testing");

    for (const pkg of manifest.APP_RELEASE_PACKAGES) {
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

  it("does not contain duplicate package metadata", () => {
    expect(new Set(manifest.PUBLIC_PACKAGE_NAMES).size).toBe(manifest.PUBLIC_PACKAGE_NAMES.length);
    expect(new Set(manifest.PUBLIC_PACKAGE_DIRS).size).toBe(manifest.PUBLIC_PACKAGE_DIRS.length);
  });
});
