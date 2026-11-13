import { RevokeRelease409DetailsOriginsItemKind } from "@zitadel/api/generated/model";
import { describe, expect, it, vi } from "vitest";

import { ConflictError } from "@/lib/backend/errors";
import { ReleaseInUseError, ReleaseService } from "@/lib/backend/services/release";
import { fakeClient } from "@tests/helpers/fake-client";
import { PREVIEW_URL, PRIMARY_ORIGIN } from "@tests/helpers/records";
import { rejectionOf } from "@tests/helpers/thrown-value";

const INPUT = {
  bundle: { schemas: [], flow_definitions: [], idps: [] },
  git_dirty: false,
};

describe("ReleaseService.get", () => {
  it("reads the release of the project it is bound to", async () => {
    const getRelease = vi.fn(async () => ({ id: "rel_1" }));
    const releaseService = new ReleaseService(fakeClient({ getRelease }), "proj_1");

    await releaseService.get("rel_1");

    expect(getRelease).toHaveBeenCalledWith("rel_1", { project_id: "proj_1" });
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
    function anInUseAnswer(origins: readonly unknown[]) {
      return {
        code: "rel.in_use",
        message: "release: still served by an origin",
        details: { origins },
      };
    }

    /**
     * The URL the server refused the revoke at.
     */
    const REVOKE_URL = "https://zitadel.test/api/v1/releases/rel_1/revoke";

    /**
     * The request id the server refused the revoke under.
     */
    const REQUEST_ID = "req_1";

    /**
     * The hint the refused conflict carried.
     */
    const CONFLICT_HINT = "Remove the preview first.";

    /**
     * The details the refused conflict carried.
     */
    const CONFLICT_DETAILS = { release_id: "rel_1" };

    /**
     * A service whose server refuses the revoke.
     *
     * @param body - The answer the server refuses with.
     * @returns A service bound to a project, whose revoke is refused with `body`.
     */
    function refusedWith(body: unknown): ReleaseService {
      const revokeRelease = async () => {
        throw new ConflictError("release: still served by an origin", {
          status: 409,
          url: REVOKE_URL,
          body,
          requestId: REQUEST_ID,
          hint: CONFLICT_HINT,
          details: CONFLICT_DETAILS,
        });
      };

      return new ReleaseService(fakeClient({ revokeRelease }), "proj_1");
    }

    it("fails with every origin that serves it", async () => {
      const releaseService = refusedWith(anInUseAnswer([PRIMARY, PREVIEW]));

      const refusal = await rejectionOf(() => {
        return releaseService.revoke("rel_1");
      });

      expect(refusal).toBeInstanceOf(ReleaseInUseError);
      expect(refusal).toMatchObject({ origins: [PRIMARY, PREVIEW] });
    });

    it("lists the origins that serve it as primary origins", async () => {
      const releaseService = refusedWith(anInUseAnswer([PRIMARY, PREVIEW]));

      const refusal = await rejectionOf(() => {
        return releaseService.revoke("rel_1");
      });

      expect(refusal).toMatchObject({ primaries: [PRIMARY] });
    });

    it("lists the origins that serve it as previews", async () => {
      const releaseService = refusedWith(anInUseAnswer([PRIMARY, PREVIEW]));

      const refusal = await rejectionOf(() => {
        return releaseService.revoke("rel_1");
      });

      expect(refusal).toMatchObject({ previews: [PREVIEW] });
    });

    it("fails as a conflict that keeps the server's answer", async () => {
      const releaseService = refusedWith(anInUseAnswer([PRIMARY]));

      const refusal = await rejectionOf(() => {
        return releaseService.revoke("rel_1");
      });

      expect(refusal).toBeInstanceOf(ConflictError);
      expect(refusal).toMatchObject({
        status: 409,
        url: REVOKE_URL,
        body: anInUseAnswer([PRIMARY]),
        requestId: REQUEST_ID,
        hint: CONFLICT_HINT,
        details: CONFLICT_DETAILS,
        serverCode: "rel.in_use",
        cause: expect.any(ConflictError),
      });
    });

    it.each(Object.values(RevokeRelease409DetailsOriginsItemKind))(
      "fails with the origins when one is of the kind %s the API documents",
      async (kind) => {
        const releaseService = refusedWith(anInUseAnswer([{ ...PRIMARY, kind }]));

        const refusal = await rejectionOf(() => {
          return releaseService.revoke("rel_1");
        });

        expect(refusal).toBeInstanceOf(ReleaseInUseError);
      },
    );

    it.each([
      ["another code", { ...anInUseAnswer([PRIMARY]), code: "rel.revoked" }],
      ["no origins", anInUseAnswer([])],
      ["an origin of no known kind", anInUseAnswer([{ ...PRIMARY, kind: "other" }])],
      ["an origin that is empty", anInUseAnswer([{ ...PRIMARY, origin: "" }])],
      ["a deployment that is empty", anInUseAnswer([{ ...PRIMARY, deployment_id: "" }])],
      ["no details", { code: "rel.in_use", message: "release: still served by an origin" }],
    ])("fails as the plain conflict it was when the answer has %s", async (_, body) => {
      const releaseService = refusedWith(body);

      const refusal = await rejectionOf(() => {
        return releaseService.revoke("rel_1");
      });

      expect(refusal).toBeInstanceOf(ConflictError);
      expect(refusal).not.toBeInstanceOf(ReleaseInUseError);
    });
  });
});
