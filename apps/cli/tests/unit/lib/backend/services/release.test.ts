import { HttpResponse, http } from "msw";
import { describe, expect, vi } from "vitest";

import { allowDestructive, createZitadelClient } from "@/lib/backend";
import { ReleaseService } from "@/lib/backend/services/release";
import { fakeClient } from "@tests/helpers/fake-client";
import { it } from "@tests/helpers/fixtures";

/** The server the revoke tests answer for. */
const SERVER = "http://localhost:8080";

/**
 * Revoke a release through a real client, as the command builds one inside
 * `confirmed`: revoking is destructive, so the client is unlocked first.
 *
 * @param releaseId - The release to revoke.
 * @returns What the service answers.
 */
async function revoking(releaseId: string) {
  const client = allowDestructive(
    createZitadelClient({ baseUrl: SERVER, signal: new AbortController().signal }),
  );
  return new ReleaseService(client, "proj_1").revoke(releaseId);
}

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

  it("answers revoked with the release the server revoked", async ({ server }) => {
    server.use(
      http.post(`${SERVER}/api/v1/releases/rel_1/revoke`, () => {
        return HttpResponse.json({ id: "rel_1", revoked_at: "2026-01-01T00:00:00Z" });
      }),
    );

    await expect(revoking("rel_1")).resolves.toMatchObject({
      outcome: "revoked",
      release: { id: "rel_1" },
    });
  });

  it("answers in-use with each origin and the deployment that pins the release there", async ({
    server,
  }) => {
    server.use(
      http.post(`${SERVER}/api/v1/releases/rel_1/revoke`, () => {
        return HttpResponse.json(
          {
            code: "rel.in_use",
            message: "release: still served by an origin",
            details: {
              origins: [
                { origin: "https://app.example.com", deployment_id: "dep_1" },
                { origin: "https://preview.example.com", deployment_id: "dep_2" },
              ],
            },
          },
          { status: 409 },
        );
      }),
    );

    await expect(revoking("rel_1")).resolves.toEqual({
      outcome: "in-use",
      origins: [
        { origin: "https://app.example.com", deployment_id: "dep_1" },
        { origin: "https://preview.example.com", deployment_id: "dep_2" },
      ],
    });
  });

  it("answers in-use when the origins arrive one level down, as the generic error nests them", async ({
    server,
  }) => {
    server.use(
      http.post(`${SERVER}/api/v1/releases/rel_1/revoke`, () => {
        return HttpResponse.json(
          {
            code: "rel.in_use",
            message: "release: still served by an origin",
            details: {
              details: { origins: [{ origin: "https://app.example.com", deployment_id: "dep_1" }] },
            },
          },
          { status: 409 },
        );
      }),
    );

    await expect(revoking("rel_1")).resolves.toEqual({
      outcome: "in-use",
      origins: [{ origin: "https://app.example.com", deployment_id: "dep_1" }],
    });
  });

  it("rethrows a rel.in_use refusal that names no origins", async ({ server }) => {
    server.use(
      http.post(`${SERVER}/api/v1/releases/rel_1/revoke`, () => {
        return HttpResponse.json(
          { code: "rel.in_use", message: "release: still served by an origin" },
          { status: 409 },
        );
      }),
    );

    await expect(revoking("rel_1")).rejects.toMatchObject({
      name: "ConflictError",
      serverCode: "rel.in_use",
    });
  });

  it("rethrows any other conflict rather than answering in-use", async ({ server }) => {
    server.use(
      http.post(`${SERVER}/api/v1/releases/rel_1/revoke`, () => {
        return HttpResponse.json(
          { code: "rel.revoked", message: "release: revoked" },
          { status: 409 },
        );
      }),
    );

    await expect(revoking("rel_1")).rejects.toMatchObject({
      name: "ConflictError",
      serverCode: "rel.revoked",
    });
  });
});
