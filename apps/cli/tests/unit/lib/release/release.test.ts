import { getDefaultHumanUserSchemaBody } from "@zitadel/config/defaults";
import { describe, expect, it, vi } from "vitest";

import { abbreviate, createReleaseFromBundle } from "../../../../src/lib/release/release";

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
      message: expect.stringMatching(/nothing was sent[\s\S]*bundle\.schemas\.0/),
    });
    expect(buildRelease).not.toHaveBeenCalled();
  });
});

describe("abbreviate", () => {
  // `Deployed sha256:<64 hex>` is wider than a closing line may be, so the
  // whole sentence was thrown away and replaced by "Done".
  it("cuts a content hash to a closing line a person can read", () => {
    expect(abbreviate(`sha256:${"a".repeat(64)}`)).toBe("sha256:aaaaaaaaaaaa");
  });

  it("keeps the algorithm, so what was cut is still named", () => {
    expect(abbreviate(`sha256:${"0123456789abcdef".repeat(4)}`)).toBe("sha256:0123456789ab");
  });

  it("leaves a hash short enough to read as it is", () => {
    expect(abbreviate("sha256:abc")).toBe("sha256:abc");
  });

  it("cuts a bare digest that names no algorithm", () => {
    expect(abbreviate("a".repeat(64))).toBe("aaaaaaaaaaaa");
  });
});
