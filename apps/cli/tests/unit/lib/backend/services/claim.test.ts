import {
  ApiError,
  ClaimChallengeNotFoundError,
  ProjAlreadyClaimedError,
  ProjClaimExpiredError,
  ProjClaimWindowExpiredError,
  ProjNotFoundError,
} from "@/lib/backend";
import { describe, expect, it, vi } from "vitest";

import { ClaimService } from "@/lib/backend/services/claim";
import { type ClientStubs, fakeClient } from "@tests/helpers/fake-client";

/** A service answering `stubs`, bound to one project. */
function service(stubs: ClientStubs): ClaimService {
  return new ClaimService(fakeClient(stubs), "proj_1");
}

/** A failure the server answered with, as the client translated it. */
describe("ClaimService.start", () => {
  it("answers the claim link the server minted", async () => {
    const initClaim = vi.fn(async () => ({ challenge_id: "clm_1" }));

    await expect(service({ initClaim }).start()).resolves.toMatchObject({
      outcome: "started",
      challenge: { challenge_id: "clm_1" },
    });
    expect(initClaim).toHaveBeenCalledWith("proj_1");
  });

  it("reports a project whose claim window has closed", async () => {
    await expect(
      service({
        initClaim: async () => {
          throw new ProjClaimWindowExpiredError(
            410,
            "https://example.test",
            { code: "proj.claim_window_expired" },
            "refused",
          );
        },
      }).start(),
    ).resolves.toEqual({ outcome: "window-expired" });
  });

  it("reports a project that already belongs to a team, with its dashboard", async () => {
    await expect(
      service({
        initClaim: async () => {
          throw new ProjAlreadyClaimedError(
            409,
            "https://example.test",
            {
              code: "proj.already_claimed",
              details: { team_id: "team_1", dashboard_url: "https://cloud.zitadel.com/team_1" },
            },
            "refused",
          );
        },
      }).start(),
    ).resolves.toEqual({
      outcome: "already-claimed",
      teamId: "team_1",
      dashboardUrl: "https://cloud.zitadel.com/team_1",
    });
  });

  it("raises a conflict whose body names no team, rather than reading one out of it", async () => {
    await expect(
      service({
        initClaim: async () => {
          throw new ProjAlreadyClaimedError(
            409,
            "https://example.test",
            { code: "proj.already_claimed" },
            "refused",
          );
        },
      }).start(),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("raises any other failure", async () => {
    await expect(
      service({
        initClaim: async () => {
          throw new Error("boom");
        },
      }).start(),
    ).rejects.toThrow("boom");
  });
});

describe("ClaimService.status", () => {
  it("answers a finished claim with what it finished as", async () => {
    const getClaimStatus = vi.fn(async () => ({ status: "completed" as const }));

    await expect(service({ getClaimStatus }).status("clm_1")).resolves.toMatchObject({
      outcome: "completed",
    });
    expect(getClaimStatus).toHaveBeenCalledWith("proj_1", { challenge_id: "clm_1" });
  });

  it("answers a claim nobody has followed yet as still waiting", async () => {
    await expect(
      service({ getClaimStatus: async () => ({ status: "pending" as const }) }).status("clm_1"),
    ).resolves.toEqual({ outcome: "pending" });
  });

  it("reports a claim window that has closed", async () => {
    await expect(
      service({
        getClaimStatus: async () => {
          throw new ProjClaimWindowExpiredError(
            410,
            "https://example.test",
            { code: "proj.claim_window_expired" },
            "refused",
          );
        },
      }).status("clm_1"),
    ).resolves.toEqual({ outcome: "window-expired" });
  });

  it("reports a link that has expired, which is not the window closing", async () => {
    await expect(
      service({
        getClaimStatus: async () => {
          throw new ProjClaimExpiredError(
            410,
            "https://example.test",
            { code: "proj.claim_expired" },
            "refused",
          );
        },
      }).status("clm_1"),
    ).resolves.toEqual({ outcome: "expired" });
  });

  it.each([
    ["a 410 that names no code", () => new ApiError(410, "https://example.test", {}, "refused")],
    [
      "a 410 that names another code",
      () =>
        new ProjNotFoundError(410, "https://example.test", { code: "proj.not_found" }, "refused"),
    ],
    ["a 404 that names no code", () => new ApiError(404, "https://example.test", {}, "refused")],
    [
      "a 404 for another thing than the link",
      () =>
        new ProjNotFoundError(404, "https://example.test", { code: "proj.not_found" }, "refused"),
    ],
  ])("raises %s, rather than reading it as a state of the link", async (_what, failure) => {
    await expect(
      service({
        getClaimStatus: async () => {
          throw failure();
        },
      }).status("clm_1"),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("reports a link the server has never heard of", async () => {
    await expect(
      service({
        getClaimStatus: async () => {
          throw new ClaimChallengeNotFoundError(
            404,
            "https://example.test",
            { code: "claim_challenge.not_found" },
            "refused",
          );
        },
      }).status("clm_1"),
    ).resolves.toEqual({ outcome: "not-found" });
  });

  it("reads a rate-limited poll as still waiting, so the caller keeps polling", async () => {
    await expect(
      service({
        getClaimStatus: async () => {
          throw new ApiError(429, "https://example.test", {}, "refused");
        },
      }).status("clm_1"),
    ).resolves.toEqual({ outcome: "pending" });
  });

  it("raises any other failure", async () => {
    await expect(
      service({
        getClaimStatus: async () => {
          throw new ApiError(500, "https://example.test", {}, "refused");
        },
      }).status("clm_1"),
    ).rejects.toMatchObject({ status: 500 });
  });
});
