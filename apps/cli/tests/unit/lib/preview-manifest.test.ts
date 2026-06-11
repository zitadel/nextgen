import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  loadPreviewManifest,
  parsePreviewManifest,
  previewNpmVersions,
  previewServerImage,
} from "../../../src/lib/preview-manifest";

const tempDirs: string[] = [];
const digest = `sha256:${"a".repeat(64)}`;

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("preview manifest", () => {
  it("loads a valid zitadel-preview manifest from disk", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "preview.json"), JSON.stringify(validManifest()));

    const manifest = await loadPreviewManifest("preview.json", cwd);

    expect(manifest.product).toMatchObject({ name: "zitadel-preview", version: "0.1.0" });
    expect(previewServerImage(manifest)).toBe("ghcr.io/zitadel/nextgen:v0.1.0-alpha.3");
    expect(previewNpmVersions(manifest)).toMatchObject({
      "@zitadel/cli": "0.1.0-alpha.4",
      "@zitadel/sdk-next": "0.1.0-alpha.2",
    });
  });

  it("rejects non-0.x product versions", () => {
    expect(() =>
      parsePreviewManifest(JSON.stringify(validManifest({ product: { version: "5.0.0" } }))),
    ).toThrow(/product.version must be a 0.x.y version/);
  });

  it("rejects mutable server image tags", () => {
    expect(() =>
      parsePreviewManifest(
        JSON.stringify(
          validManifest({
            server: {
              version: "latest",
              ref: "ghcr.io/zitadel/nextgen:latest",
            },
          }),
        ),
      ),
    ).toThrow(/mutable tag latest/);
  });

  it("rejects unsupported component kinds unless they are optional", () => {
    expect(() =>
      parsePreviewManifest(
        JSON.stringify({ ...validManifest(), components: [...validManifest().components, { kind: "helm-chart" }] }),
      ),
    ).toThrow(/helm-chart is not supported/);

    const manifest = parsePreviewManifest(
      JSON.stringify({
        ...validManifest(),
        components: [...validManifest().components, { kind: "helm-chart", optional: true }],
      }),
    );
    expect(manifest.components.at(-1)).toMatchObject({ kind: "helm-chart", optional: true });
  });
});

async function tempDir(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-preview-manifest-"));
  tempDirs.push(cwd);
  return cwd;
}

function validManifest(
  overrides: {
    product?: Partial<{ version: string; commit: string }>;
    server?: Partial<{ version: string; ref: string; digest: string }>;
  } = {},
) {
  return {
    schema_version: 1,
    product: {
      name: "zitadel-preview",
      version: overrides.product?.version ?? "0.1.0",
      commit: overrides.product?.commit ?? "abc123",
    },
    components: [
      {
        kind: "container",
        name: "ghcr.io/zitadel/nextgen",
        version: overrides.server?.version ?? "v0.1.0-alpha.3",
        ref: overrides.server?.ref ?? "ghcr.io/zitadel/nextgen:v0.1.0-alpha.3",
        digest: overrides.server?.digest ?? digest,
      },
      { kind: "npm", name: "@zitadel/cli", version: "0.1.0-alpha.4" },
      { kind: "npm", name: "@zitadel/sdk-next", version: "0.1.0-alpha.2" },
    ],
  };
}
