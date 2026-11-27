import { RevokeRelease409DetailsOriginsItemKind } from "@zitadel/api/generated/model";
import { HttpResponse, type JsonBodyType } from "msw";
import type { SetupServer } from "msw/node";
import { describe, expect } from "vitest";

import { it } from "@tests/fixtures";

import { allowDestructive } from "@/lib/backend";
import { ConflictError } from "@/lib/backend/errors";
import { ReleaseService } from "@/lib/backend/services/release";
import { answering, testClient } from "@tests/helpers/api-answers";
import { PREVIEW_URL, PRIMARY_ORIGIN } from "@tests/helpers/records";
import { rejectionOf } from "@tests/helpers/thrown-value";

const INPUT = {
  bundle: { schemas: [], flow_definitions: [], idps: [] },
  git_dirty: false,
};

/** A service on a test client that may revoke releases, bound to `proj_1`. */
function service(): ReleaseService {
  return new ReleaseService(allowDestructive(testClient()), "proj_1");
}

describe("ReleaseService.get", () => {
  it("reads the release of the project it is bound to", async ({ server }) => {
    const read = answering(server, "getRelease", { id: "rel_1" });

    await service().get("rel_1");

    expect(
      read.map(({ params, url }) => [params.release_id, url.searchParams.get("project_id")]),
    ).toEqual([["rel_1", "proj_1"]]);
  });
});

describe("ReleaseService.create", () => {
  it("sends the input as given, with nothing filled in", async ({ server }) => {
    const built = answering(server, "buildRelease", { id: "rel_1" });

    await service().create(INPUT);

    expect(built.map(({ url, body }) => [url.searchParams.get("project_id"), body])).toEqual([
      ["proj_1", INPUT],
    ]);
  });

  it("answers the release the server built", async ({ server }) => {
    answering(server, "buildRelease", { id: "rel_1", content_hash: "sha256:abc" });

    await expect(service().create(INPUT)).resolves.toMatchObject({ id: "rel_1" });
  });

  it("refuses content that builds back to a revoked release, naming it", async ({ server }) => {
    answering(server, "buildRelease", {
      id: "rel_1",
      content_hash: "sha256:abc",
      revoked_at: "2026-01-01T00:00:00Z",
    });

    await expect(service().create(INPUT)).rejects.toMatchObject({
      name: "ConflictError",
      message: expect.stringContaining("rel_1"),
    });
  });
});

describe("ReleaseService.revoke", () => {
  it("revokes the release of the project it is bound to", async ({ server }) => {
    const revoked = answering(server, "revokeRelease", { id: "rel_1" });

    await service().revoke("rel_1");

    expect(
      revoked.map(({ params, url }) => [params.release_id, url.searchParams.get("project_id")]),
    ).toEqual([["rel_1", "proj_1"]]);
  });

  it("answers revoked with the release the server revoked", async ({ server }) => {
    answering(server, "revokeRelease", { id: "rel_1" });

    await expect(service().revoke("rel_1")).resolves.toEqual({
      outcome: "revoked",
      release: { id: "rel_1" },
    });
  });

  describe("when an origin still serves the release", () => {
    /**
     * A primary origin that serves the release, as the server names it.
     */
    const PRIMARY = { origin: PRIMARY_ORIGIN, deployment_id: "dep_1", kind: "primary" };

    /**
     * A preview that serves the release, as the server names it.
     */
    const PREVIEW = { origin: PREVIEW_URL, deployment_id: "dep_2", kind: "preview" };

    /**
     * The answer the server refuses a revoke with when origins serve the release.
     *
     * @param origins - The origins the answer names.
     * @returns The answer's body.
     */
    function anInUseAnswer(origins: readonly JsonBodyType[]) {
      return {
        code: "rel.in_use",
        message: "release: still served by an origin",
        details: { origins },
      };
    }

    /**
     * A service whose server refuses the revoke.
     *
     * @param server - The test's MSW server.
     * @param body - The answer the server refuses with.
     * @returns A service bound to a project, whose revoke is refused with `body`.
     */
    function refusedWith(server: SetupServer, body: JsonBodyType): ReleaseService {
      answering(server, "revokeRelease", HttpResponse.json(body, { status: 409 }));

      return service();
    }

    it("answers in-use with every origin that serves it, in the order the server named them", async ({
      server,
    }) => {
      const releaseService = refusedWith(server, anInUseAnswer([PRIMARY, PREVIEW]));

      await expect(releaseService.revoke("rel_1")).resolves.toEqual({
        outcome: "in-use",
        origins: [PRIMARY, PREVIEW],
      });
    });

    it.for(Object.values(RevokeRelease409DetailsOriginsItemKind))(
      "answers in-use when an origin is of the kind %s the API documents",
      async (kind, { server }) => {
        const releaseService = refusedWith(server, anInUseAnswer([{ ...PRIMARY, kind }]));

        await expect(releaseService.revoke("rel_1")).resolves.toMatchObject({
          outcome: "in-use",
        });
      },
    );

    it.for([
      { what: "another code", body: { ...anInUseAnswer([PRIMARY]), code: "rel.revoked" } },
      { what: "no origins", body: anInUseAnswer([]) },
      { what: "an origin of no known kind", body: anInUseAnswer([{ ...PRIMARY, kind: "other" }]) },
      { what: "an origin that is empty", body: anInUseAnswer([{ ...PRIMARY, origin: "" }]) },
      {
        what: "a deployment that is empty",
        body: anInUseAnswer([{ ...PRIMARY, deployment_id: "" }]),
      },
      {
        what: "no details",
        body: { code: "rel.in_use", message: "release: still served by an origin" },
      },
    ])(
      "fails as the plain conflict it was when the answer has $what",
      async ({ body }, { server }) => {
        const releaseService = refusedWith(server, body);

        const refusal = await rejectionOf(() => {
          return releaseService.revoke("rel_1");
        });

        expect(refusal).toBeInstanceOf(ConflictError);
      },
    );
  });
});
