import { describe, expect, it, vi } from "vitest";

import { ConflictError } from "@/lib/backend/errors";
import { ReleaseService } from "@/lib/backend/services/release";
import { fakeClient } from "@tests/helpers/fake-client";

const INPUT = {
  bundle: { schemas: [], flow_definitions: [], idps: [] },
  git_dirty: false,
};

const SERVED = { origin: "https://app.acme.com", deployment_id: "dep_1" };

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

  it("answers the revoked release", async () => {
    const revokeRelease = vi.fn(async () => ({ id: "rel_1" }));
    const releaseService = new ReleaseService(fakeClient({ revokeRelease }), "proj_1");

    await expect(releaseService.revoke("rel_1")).resolves.toEqual({
      outcome: "revoked",
      release: { id: "rel_1" },
    });
  });

  it.each([
    ["the contract's", { origins: [SERVED] }],
    ["the server's nested", { details: { origins: [SERVED] } }],
  ])("names the origins %s details say still serve it", async (_, details) => {
    const revokeRelease = vi.fn(async () => {
      throw new ConflictError("in use", {
        status: 409,
        body: { code: "rel.in_use", message: "release: still served by an origin", details },
      });
    });
    const releaseService = new ReleaseService(fakeClient({ revokeRelease }), "proj_1");

    await expect(releaseService.revoke("rel_1")).resolves.toEqual({
      outcome: "in-use",
      origins: [SERVED],
    });
  });

  it("throws any other conflict", async () => {
    const revokeRelease = vi.fn(async () => {
      throw new ConflictError("other", { status: 409, body: { code: "rel.other" } });
    });
    const releaseService = new ReleaseService(fakeClient({ revokeRelease }), "proj_1");

    await expect(releaseService.revoke("rel_1")).rejects.toMatchObject({ name: "ConflictError" });
  });
});
