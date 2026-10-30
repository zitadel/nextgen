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
    expect(bundle.branding).toBeUndefined();
  });

  it("sends the branding as one object under `branding`, never a `brandings` list", async () => {
    const cwd = await project({
      ".zitadel/schemas/human-user.json": { objectType: "human-user" },
      ".zitadel/branding/branding.json": { layout: "centered" },
    });

    const { bundle, resourceCount } = await buildBundle(cwd);

    expect(resourceCount).toBe(2);
    expect(bundle.branding).toMatchObject({ layout: "centered" });
    expect(bundle).not.toHaveProperty("brandings");
  });

  it("carries policy files under `policies`, named in step with their files", async () => {
    const cwd = await project({
      ".zitadel/policies/auth.factor.password.set.json": {
        $schema: "../meta/policy.json",
        operation: "auth.factor.password.set",
        config: { min_length: 12 },
      },
    });

    const { bundle, resourceCount, policyFiles } = await buildBundle(cwd);

    expect(resourceCount).toBe(1);
    expect(bundle.policies).toEqual([
      { operation: "auth.factor.password.set", config: { min_length: 12 } },
    ]);
    expect(policyFiles).toEqual(["auth.factor.password.set.json"]);
  });

  it("never carries a policy test file, valid or not", async () => {
    const cwd = await project({
      ".zitadel/policies/auth.factor.password.set.json": {
        operation: "auth.factor.password.set",
        config: {},
      },
      ".zitadel/policies/auth.factor.password.set.test.json": { cases: "not a policy" },
    });

    const { bundle, resourceCount, policyFiles } = await buildBundle(cwd);

    expect(resourceCount).toBe(1);
    expect(bundle.policies).toEqual([{ operation: "auth.factor.password.set", config: {} }]);
    expect(policyFiles).toEqual(["auth.factor.password.set.json"]);
  });

  it("leaves `policies` out when there are none, so a server without the kind takes it", async () => {
    const cwd = await project({ ".zitadel/schemas/human-user.json": { objectType: "human-user" } });

    const { bundle } = await buildBundle(cwd);

    expect(bundle).not.toHaveProperty("policies");
  });

  it("refuses an empty .zitadel/ directory", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-bundle-empty-"));
    dir = cwd;

    await expect(buildBundle(cwd)).rejects.toMatchObject({ code: "E_VALIDATION" });
  });

  it("refuses more than one branding descriptor", async () => {
    const cwd = await project({
      ".zitadel/branding/one.json": { name: "one" },
      ".zitadel/branding/two.json": { name: "two" },
    });

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
