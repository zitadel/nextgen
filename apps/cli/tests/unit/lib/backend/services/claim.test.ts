import { ApiError, errorClassFor } from "@/lib/backend";
import { describe, expect, it, vi } from "vitest";

import { ClaimService } from "@/lib/backend/services/claim";
import { type ClientStubs, fakeClient } from "@tests/helpers/fake-client";

/** A service answering `stubs`, bound to one project. */
function service(stubs: ClientStubs): ClaimService {
  return new ClaimService(fakeClient(stubs), "proj_1");
}

/** A failure the server answered with, as the client translated it. */
function refusal(status: number, code?: string, details?: unknown): ApiError {
  const body = {
    ...(code === undefined ? {} : { code }),
    ...(details === undefined ? {} : { details }),
  };
  const Failure = errorClassFor(code) ?? ApiError;
  return new Failure(status, "https://example.test", body, "refused");
}

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
          throw refusal(410, "proj.claim_window_expired");
        },
      }).start(),
    ).resolves.toEqual({ outcome: "window-expired" });
  });

  it("reports a project that already belongs to a team, with its dashboard", async () => {
    await expect(
      service({
        initClaim: async () => {
          throw refusal(409, "proj.already_claimed", {
            team_id: "team_1",
            dashboard_url: "https://cloud.zitadel.com/team_1",
          });
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
          throw refusal(409, "proj.already_claimed");
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
          throw refusal(410, "proj.claim_window_expired");
        },
      }).status("clm_1"),
    ).resolves.toEqual({ outcome: "window-expired" });
  });

  it("reports a link that has expired, which is not the window closing", async () => {
    await expect(
      service({
        getClaimStatus: async () => {
          throw refusal(410, "proj.claim_expired");
        },
      }).status("clm_1"),
    ).resolves.toEqual({ outcome: "expired" });
  });

  it.each([
    ["a 410 that names no code", () => refusal(410)],
    ["a 410 that names another code", () => refusal(410, "proj.not_found")],
    ["a 404 that names no code", () => refusal(404)],
    ["a 404 for another thing than the link", () => refusal(404, "proj.not_found")],
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
          throw refusal(404, "claim_challenge.not_found");
        },
      }).status("clm_1"),
    ).resolves.toEqual({ outcome: "not-found" });
  });

  it("reads a rate-limited poll as still waiting, so the caller keeps polling", async () => {
    await expect(
      service({
        getClaimStatus: async () => {
          throw refusal(429);
        },
      }).status("clm_1"),
    ).resolves.toEqual({ outcome: "pending" });
  });

  it("raises any other failure", async () => {
    await expect(
      service({
        getClaimStatus: async () => {
          throw refusal(500);
        },
      }).status("clm_1"),
    ).rejects.toMatchObject({ status: 500 });
  });
});
