import { describe, expect, it, vi } from "vitest";

import { ReleaseService } from "../../../../src/lib/backend/release-service";

const input = {
  bundle: { schemas: [], flow_definitions: [], idps: [] },
  git_dirty: false,
};

describe("ReleaseService.create", () => {
  it("sends the input as given, with nothing filled in", async () => {
    const buildRelease = vi.fn(async () => ({ id: "rel_1" }));
    const releaseService = new ReleaseService({ buildRelease } as never, "proj_1");

    await releaseService.create(input);

    expect(buildRelease).toHaveBeenCalledWith(input, { project_id: "proj_1" });
  });

  it("refuses content that builds back to a revoked release, naming it", async () => {
    const buildRelease = vi.fn(async () => ({
      id: "rel_1",
      content_hash: "sha256:abc",
      revoked_at: "2026-01-01T00:00:00Z",
    }));
    const releaseService = new ReleaseService({ buildRelease } as never, "proj_1");

    await expect(releaseService.create(input)).rejects.toMatchObject({
      code: "E_CONFLICT",
      message: expect.stringContaining("rel_1"),
    });
  });
});
