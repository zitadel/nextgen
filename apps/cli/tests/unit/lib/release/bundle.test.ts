import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildBundle } from "../../../../src/lib/release/bundle";

let dir: string;

async function project(files: Record<string, unknown>): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), "zitadel-bundle-"));
  for (const [relPath, content] of Object.entries(files)) {
    await mkdir(join(dir, relPath, ".."), { recursive: true });
    await writeFile(join(dir, relPath), JSON.stringify(content));
  }
  return dir;
}

afterEach(async () => {
  if (dir) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("buildBundle", () => {
  it("groups the resources by kind and strips the $schema affordance", async () => {
    const cwd = await project({
      ".zitadel/schemas/human-user.json": {
        $schema: "../meta/user-schema.json",
        objectType: "human-user",
      },
      ".zitadel/flows/default-login.json": {
        $schema: "../meta/flow-definition.json",
        name: "default-login",
      },
    });

    const { bundle, resourceCount } = await buildBundle(cwd);

    expect(resourceCount).toBe(2);
    expect(bundle.schemas).toEqual([{ objectType: "human-user" }]);
    expect(bundle.flow_definitions).toEqual([{ name: "default-login" }]);
    expect(bundle.brandings).toEqual([]);
  });

  it("refuses an empty .zitadel/ directory", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-bundle-empty-"));
    dir = cwd;

    await expect(buildBundle(cwd)).rejects.toMatchObject({ code: "E_VALIDATION" });
  });

  it("refuses a bundle over the fifty-resource cap", async () => {
    const files: Record<string, unknown> = {};
    for (let i = 0; i < 51; i += 1) {
      files[`.zitadel/schemas/schema-${i}.json`] = { objectType: `type-${i}` };
    }
    const cwd = await project(files);

    await expect(buildBundle(cwd)).rejects.toMatchObject({ code: "E_VALIDATION" });
  });
});
