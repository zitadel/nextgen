import { getDefaultHumanUserSchemaBody } from "@zitadel/config/defaults";
import { describe, expect, it, vi } from "vitest";

import { ReleaseService } from "../../../../src/lib/backend/release-service";

/** A client whose build answers with an empty release, recording what it was sent. */
function aClient() {
  const buildRelease = vi.fn(async (body: unknown) => ({ id: "rel_1", body }));
  return { buildRelease, client: { buildRelease } as never };
}

const source = { gitSha: null, gitDirty: false };

describe("ReleaseService.create", () => {
  it("sends the bundle as read, with nothing filled in", async () => {
    const { buildRelease, client } = aClient();
    const bundle = { schemas: [getDefaultHumanUserSchemaBody()], flow_definitions: [], idps: [] };

    const releaseService = new ReleaseService(client, "proj_1");

    await releaseService.create(bundle, source);

    expect(buildRelease).toHaveBeenCalledWith(
      { bundle, git_dirty: false },
      { project_id: "proj_1" },
    );
  });

  it("refuses a bundle the API does not take before sending it, naming the field", async () => {
    const { buildRelease, client } = aClient();
    const bundle = { schemas: [{ kind: "user-schema" }], flow_definitions: [], idps: [] };

    const releaseService = new ReleaseService(client, "proj_1");

    await expect(releaseService.create(bundle, source)).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringMatching(/nothing was sent[\s\S]*bundle\.schemas\.0/),
    });
    expect(buildRelease).not.toHaveBeenCalled();
  });

  it("refuses content that builds back to a revoked release, naming it", async () => {
    const buildRelease = vi.fn(async () => ({
      id: "rel_1",
      content_hash: "sha256:abc",
      revoked_at: "2026-01-01T00:00:00Z",
    }));
    const releaseService = new ReleaseService({ buildRelease } as never, "proj_1");
    const bundle = { schemas: [getDefaultHumanUserSchemaBody()], flow_definitions: [], idps: [] };

    await expect(releaseService.create(bundle, source)).rejects.toMatchObject({
      code: "E_CONFLICT",
      message: expect.stringContaining("rel_1"),
    });
  });
});
