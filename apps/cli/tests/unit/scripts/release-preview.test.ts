import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

type ReleasePreviewModule = {
  assertImmutableImageRef: (ref: string) => void;
  parseAdditionalNpmPackages: (input: string) => Array<{ name: string; version: string }>;
  preparePreviewRelease: (options: {
    previewVersion: string;
    commit: string;
    serverImage: string;
    cliVersion: string;
    sdkNextVersion: string;
    additionalNpmPackagesJson?: string;
    outDir: string;
    repository?: string;
    resolveDockerDigest?: (ref: string) => Promise<string>;
    verifyNpmPackage?: (name: string, version: string) => Promise<void>;
  }) => Promise<{
    tagName: string;
    title: string;
    assetName: string;
    manifestPath: string;
    notesPath: string;
    manifestUrl: string;
    manifest: {
      product: { version: string };
      components: Array<{ kind: string; name?: string; version?: string; ref?: string }>;
    };
  }>;
};

let releasePreview: ReleasePreviewModule;
const tempDirs: string[] = [];
const digest = `sha256:${"b".repeat(64)}`;

beforeAll(async () => {
  releasePreview = (await import(
    new URL("../../../../../scripts/release-preview.mjs", import.meta.url).href
  )) as ReleasePreviewModule;
});

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("release-preview script", () => {
  it("generates a manifest and release notes from existing artifacts", async () => {
    const outDir = await tempDir();
    const verifyNpmPackage = vi.fn(async () => undefined);
    const resolveDockerDigest = vi.fn(async () => digest);

    const result = await releasePreview.preparePreviewRelease({
      previewVersion: "0.1.0",
      commit: "abc123",
      serverImage: "ghcr.io/zitadel/nextgen:v0.1.0-alpha.3",
      cliVersion: "0.1.0-alpha.4",
      sdkNextVersion: "0.1.0-alpha.2",
      additionalNpmPackagesJson: JSON.stringify({ "@zitadel/sdk-react": "0.1.0-alpha.1" }),
      outDir,
      repository: "zitadel/nextgen",
      resolveDockerDigest,
      verifyNpmPackage,
    });

    expect(result.tagName).toBe("zitadel-preview-v0.1.0");
    expect(result.title).toBe("ZITADEL Preview 0.1.0");
    expect(result.assetName).toBe("zitadel-preview-0.1.0.json");
    expect(result.manifest.product.version).toBe("0.1.0");
    expect(result.manifest.components).toContainEqual({
      kind: "container",
      name: "ghcr.io/zitadel/nextgen",
      version: "v0.1.0-alpha.3",
      ref: "ghcr.io/zitadel/nextgen:v0.1.0-alpha.3",
      digest,
    });
    expect(verifyNpmPackage).toHaveBeenCalledWith("@zitadel/cli", "0.1.0-alpha.4");
    expect(verifyNpmPackage).toHaveBeenCalledWith("@zitadel/sdk-next", "0.1.0-alpha.2");
    expect(verifyNpmPackage).toHaveBeenCalledWith("@zitadel/sdk-react", "0.1.0-alpha.1");

    const notes = await readFile(result.notesPath, "utf8");
    expect(notes).toContain("ZITADEL Preview 0.1.0");
    expect(notes).toContain(result.manifestUrl);
    expect(notes).toContain("npx @zitadel/cli@0.1.0-alpha.4 start --preview-manifest");
  });

  it("rejects mutable server image tags", () => {
    expect(() => releasePreview.assertImmutableImageRef("ghcr.io/zitadel/nextgen:latest")).toThrow(
      /mutable tag latest/,
    );
  });

  it("stops when npm package verification fails", async () => {
    const outDir = await tempDir();
    await expect(
      releasePreview.preparePreviewRelease({
        previewVersion: "0.1.0",
        commit: "abc123",
        serverImage: "ghcr.io/zitadel/nextgen:v0.1.0-alpha.3",
        cliVersion: "0.1.0-alpha.4",
        sdkNextVersion: "0.1.0-alpha.2",
        outDir,
        resolveDockerDigest: async () => digest,
        verifyNpmPackage: async () => {
          throw new Error("missing npm package");
        },
      }),
    ).rejects.toThrow("missing npm package");
  });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zitadel-release-preview-"));
  tempDirs.push(dir);
  return dir;
}
