import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

type ReleaseArtifactsModule = {
  containerTags: (input: { image?: string; version: string; prerelease: boolean }) => string[];
  readServerRelease: (repoRoot: string) => Promise<{
    name: string;
    version: string;
    tag: string;
    prerelease: boolean;
  }>;
  stageServerNpmBinaries: (options: {
    repoRoot: string;
    outDir: string;
    version: string;
    platformPackages: Array<{
      goos: string;
      goarch: string;
      packageName: string;
      packageDir: string;
    }>;
  }) => Promise<void>;
  validateSemver: (version: string) => void;
  verifyLocalArtifacts: (options: {
    repoRoot: string;
    release: { name: string; version: string; tag: string; prerelease: boolean };
    outDir: string;
  }) => Promise<void>;
};

const tempDirs: string[] = [];

async function loadModule(): Promise<ReleaseArtifactsModule> {
  return (await import(
    new URL("../../../../../scripts/release-artifacts.mjs", import.meta.url).href
  )) as ReleaseArtifactsModule;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("release artifact helpers", () => {
  it("reads the server npm package as the product version source", async () => {
    const { readServerRelease } = await loadModule();
    const repoRoot = await mkdtemp(join(tmpdir(), "zitadel-server-package-"));
    tempDirs.push(repoRoot);
    await mkdir(join(repoRoot, "apps/server"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/server/package.json"),
      JSON.stringify({
        name: "@zitadel/server",
        version: "0.1.0-alpha.6",
      }),
    );

    await expect(readServerRelease(repoRoot)).resolves.toEqual({
      name: "@zitadel/server",
      version: "0.1.0-alpha.6",
      tag: "v0.1.0-alpha.6",
      prerelease: true,
    });
  });

  it("only adds latest for stable container releases", async () => {
    const { containerTags } = await loadModule();

    expect(containerTags({ version: "1.2.3-alpha.1", prerelease: true })).toEqual([
      "ghcr.io/zitadel/nextgen:1.2.3-alpha.1",
    ]);
    expect(containerTags({ version: "1.2.3", prerelease: false })).toEqual([
      "ghcr.io/zitadel/nextgen:1.2.3",
      "ghcr.io/zitadel/nextgen:latest",
    ]);
  });

  it("validates semver-like release versions", async () => {
    const { validateSemver } = await loadModule();

    expect(() => validateSemver("1.2.3")).not.toThrow();
    expect(() => validateSemver("1.2.3-alpha.1")).not.toThrow();
    expect(() => validateSemver("v1.2.3")).toThrow("invalid release version");
  });

  it("stages built server binaries into platform npm packages", async () => {
    const { stageServerNpmBinaries } = await loadModule();
    const repoRoot = await mkdtemp(join(tmpdir(), "zitadel-server-package-"));
    tempDirs.push(repoRoot);
    const outDir = join(repoRoot, "dist/release/0.1.0-alpha.6");
    const source = join(outDir, "build/linux/amd64/nextgen");
    await mkdir(join(outDir, "build/linux/amd64"), { recursive: true });
    await writeFile(source, "server-binary");

    await stageServerNpmBinaries({
      repoRoot,
      outDir,
      version: "0.1.0-alpha.6",
      platformPackages: [
        {
          goos: "linux",
          goarch: "amd64",
          packageName: "@zitadel/server-linux-x64",
          packageDir: "apps/server-linux-x64",
        },
      ],
    });

    const destination = join(repoRoot, "apps/server-linux-x64/bin/nextgen");
    await expect(readFile(destination, "utf8")).resolves.toBe("server-binary");
    expect((await stat(destination)).mode & 0o111).toBeGreaterThan(0);
  });

  it("rejects incomplete local release artifacts", async () => {
    const { verifyLocalArtifacts } = await loadModule();
    const repoRoot = await mkdtemp(join(tmpdir(), "zitadel-release-artifacts-"));
    tempDirs.push(repoRoot);
    const outDir = join(repoRoot, "dist/release/0.1.0-alpha.6");
    await mkdir(outDir, { recursive: true });

    await expect(
      verifyLocalArtifacts({
        repoRoot,
        outDir,
        release: {
          name: "@zitadel/server",
          version: "0.1.0-alpha.6",
          tag: "v0.1.0-alpha.6",
          prerelease: true,
        },
      }),
    ).rejects.toThrow("missing release artifacts");
  });
});
