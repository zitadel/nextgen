import { HttpResponse } from "msw";
import { describe, expect } from "vitest";

import { it } from "@tests/fixtures";

import { ClaimService } from "@/lib/backend/services/claim";
import { answering, refusal, testClient } from "@tests/helpers/api-answers";

/** A service on a test client, bound to one project. */
function service(): ClaimService {
  return new ClaimService(testClient(), "proj_1");
}

/** The refusal of a project that already belongs to a team, naming that team. */
function alreadyClaimedBy(details: { team_id: string; dashboard_url: string }): Response {
  return HttpResponse.json(
    { code: "proj.already_claimed", message: "proj.already_claimed", details },
    { status: 409 },
  );
}

describe("ClaimService.start", () => {
  it("answers the claim link the server minted", async ({ server }) => {
    const started = answering(server, "createProjectClaim", { challenge_id: "clm_1" });

    await expect(service().start()).resolves.toMatchObject({
      outcome: "started",
      challenge: { challenge_id: "clm_1" },
    });
    expect(
      started.map(({ params }) => {
        return params.project_id;
      }),
    ).toEqual(["proj_1"]);
  });

  it("reports a project whose claim window has closed", async ({ server }) => {
    answering(server, "createProjectClaim", refusal(410, "proj.claim_window_expired"));

    await expect(service().start()).resolves.toEqual({ outcome: "window-expired" });
  });

  it("reports a project that already belongs to a team, with its dashboard", async ({ server }) => {
    answering(
      server,
      "createProjectClaim",
      alreadyClaimedBy({
        team_id: "team_1",
        dashboard_url: "https://cloud.zitadel.com/team_1",
      }),
    );

    await expect(service().start()).resolves.toEqual({
      outcome: "already-claimed",
      teamId: "team_1",
      dashboardUrl: "https://cloud.zitadel.com/team_1",
    });
  });

  it("raises a conflict whose body names no team, rather than reading one out of it", async ({
    server,
  }) => {
    answering(server, "createProjectClaim", refusal(409, "proj.already_claimed"));

    await expect(service().start()).rejects.toMatchObject({ status: 409 });
  });

  it("raises any other failure", async ({ server }) => {
    answering(server, "createProjectClaim", refusal(500, "internal"));

    await expect(service().start()).rejects.toMatchObject({ status: 500 });
  });
});

describe("ClaimService.status", () => {
  it("answers a finished claim with what it finished as", async ({ server }) => {
    const polled = answering(server, "getProjectClaimStatus", { status: "completed" });

    await expect(service().status("clm_1")).resolves.toMatchObject({
      outcome: "completed",
    });
    expect(
      polled.map(({ params, url }) => {
        return [params.project_id, url.searchParams.get("challenge_id")];
      }),
    ).toEqual([["proj_1", "clm_1"]]);
  });

  it("answers a claim nobody has followed yet as still waiting", async ({ server }) => {
    answering(server, "getProjectClaimStatus", { status: "pending" });

    await expect(service().status("clm_1")).resolves.toEqual({ outcome: "pending" });
  });

  it("reports a claim window that has closed", async ({ server }) => {
    answering(server, "getProjectClaimStatus", refusal(410, "proj.claim_window_expired"));

    await expect(service().status("clm_1")).resolves.toEqual({ outcome: "window-expired" });
  });

  it("reports a link that has expired, which is not the window closing", async ({ server }) => {
    answering(server, "getProjectClaimStatus", HttpResponse.json({}, { status: 410 }));

    await expect(service().status("clm_1")).resolves.toEqual({ outcome: "expired" });
  });

  it("reports a link the server has never heard of", async ({ server }) => {
    answering(server, "getProjectClaimStatus", refusal(404, "claim_challenge.not_found"));

    await expect(service().status("clm_1")).resolves.toEqual({ outcome: "not-found" });
  });

  it("reads a rate-limited poll as still waiting, so the caller keeps polling", async ({
    server,
  }) => {
    answering(server, "getProjectClaimStatus", refusal(429, "rate_limited"));

    await expect(service().status("clm_1")).resolves.toEqual({ outcome: "pending" });
  });

  it("raises any other failure", async ({ server }) => {
    answering(server, "getProjectClaimStatus", refusal(500, "internal"));

    await expect(service().status("clm_1")).rejects.toMatchObject({ status: 500 });
  });
});
