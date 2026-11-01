import { getDefaultHumanUserSchemaBody } from "@zitadel/config/defaults";
import { describe, expect, it, vi } from "vitest";

import { bundleIssues, createReleaseFromBundle } from "../../../../src/lib/release/release";

/** A client whose build answers with an empty release, recording what it was sent. */
function aClient() {
  const buildRelease = vi.fn(async (body: unknown) => ({ id: "rel_1", body }));
  return { buildRelease, client: { buildRelease } as never };
}

const source = { gitSha: null, gitDirty: false };

describe("createReleaseFromBundle", () => {
  it("sends the bundle as read, with nothing filled in", async () => {
    const { buildRelease, client } = aClient();
    const bundle = { schemas: [getDefaultHumanUserSchemaBody()], flow_definitions: [], idps: [] };

    await createReleaseFromBundle(client, "proj_1", bundle, source);

    expect(buildRelease).toHaveBeenCalledWith(
      { bundle, git_dirty: false },
      { project_id: "proj_1" },
    );
  });

  it("refuses a bundle the API does not take before sending it, naming the field", async () => {
    const { buildRelease, client } = aClient();
    const bundle = { schemas: [{ kind: "user-schema" }], flow_definitions: [], idps: [] };

    await expect(createReleaseFromBundle(client, "proj_1", bundle, source)).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining("bundle.schemas.0"),
    });
    expect(buildRelease).not.toHaveBeenCalled();
  });
});

describe("bundleIssues", () => {
  it("finds nothing in a bundle the API takes", () => {
    expect(
      bundleIssues({ schemas: [getDefaultHumanUserSchemaBody()], flow_definitions: [], idps: [] }),
    ).toEqual([]);
  });

  it("places each problem by its path inside the bundle", () => {
    const issues = bundleIssues({ schemas: [], flow_definitions: [], idps: [{ slug: "acme" }] });

    expect(issues.map((issue) => issue.path.slice(0, 2))).toContainEqual(["idps", 0]);
  });
});
