import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
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
  it("reads the private server release record as the product version source", async () => {
    const { readServerRelease } = await loadModule();
    const repoRoot = await mkdtemp(join(tmpdir(), "zitadel-release-record-"));
    tempDirs.push(repoRoot);
    await mkdir(join(repoRoot, "apps/server-release"), { recursive: true });
    await writeFile(
      join(repoRoot, "apps/server-release/package.json"),
      JSON.stringify({
        name: "@zitadel/server-release",
        version: "0.1.0-alpha.6",
        private: true,
      }),
    );

    await expect(readServerRelease(repoRoot)).resolves.toEqual({
      name: "@zitadel/server-release",
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
          name: "@zitadel/server-release",
          version: "0.1.0-alpha.6",
          tag: "v0.1.0-alpha.6",
          prerelease: true,
        },
      }),
    ).rejects.toThrow("missing release artifacts");
  });
});
