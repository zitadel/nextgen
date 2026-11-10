import { describe, expect, it, vi } from "vitest";

import { ReleaseService } from "@/lib/backend/services/release";
import { fakeClient } from "@tests/helpers/fake-client";

const INPUT = {
  bundle: { schemas: [], flow_definitions: [], idps: [] },
  git_dirty: false,
};

describe("ReleaseService.get", () => {
  it("reads the release of the project it is bound to", async () => {
    const getReleaseById = vi.fn(async () => ({ id: "rel_1" }));
    const releaseService = new ReleaseService(fakeClient({ getReleaseById }), "proj_1");

    await releaseService.get("rel_1");

    expect(getReleaseById).toHaveBeenCalledWith("rel_1", { project_id: "proj_1" });
  });
});

describe("ReleaseService.create", () => {
  it("sends the input as given, with nothing filled in", async () => {
    const buildRelease = vi.fn(async () => ({ id: "rel_1" }));
    const releaseService = new ReleaseService(fakeClient({ buildRelease }), "proj_1");

    await releaseService.create(INPUT);

    expect(buildRelease).toHaveBeenCalledWith(INPUT, { project_id: "proj_1" });
  });

  it("answers the release the server built", async () => {
    const buildRelease = vi.fn(async () => ({ id: "rel_1", content_hash: "sha256:abc" }));
    const releaseService = new ReleaseService(fakeClient({ buildRelease }), "proj_1");

    await expect(releaseService.create(INPUT)).resolves.toMatchObject({ id: "rel_1" });
  });

  it("refuses content that builds back to a revoked release, naming it", async () => {
    const buildRelease = vi.fn(async () => ({
      id: "rel_1",
      content_hash: "sha256:abc",
      revoked_at: "2026-01-01T00:00:00Z",
    }));
    const releaseService = new ReleaseService(fakeClient({ buildRelease }), "proj_1");

    await expect(releaseService.create(INPUT)).rejects.toMatchObject({
      name: "ConflictError",
      message: expect.stringContaining("rel_1"),
    });
  });
});

describe("ReleaseService.revoke", () => {
  it("revokes the release of the project it is bound to", async () => {
    const revokeRelease = vi.fn(async () => ({ id: "rel_1" }));
    const releaseService = new ReleaseService(fakeClient({ revokeRelease }), "proj_1");

    await releaseService.revoke("rel_1");

    expect(revokeRelease).toHaveBeenCalledWith("rel_1", { project_id: "proj_1" });
  });
});
