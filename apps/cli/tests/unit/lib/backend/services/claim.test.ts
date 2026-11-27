import { HttpResponse } from "msw";
import { describe, expect } from "vitest";

import { it } from "@tests/fixtures";

import { ConflictError, UnavailableError } from "@/lib/backend/errors";
import { rejectionOf } from "@tests/helpers/thrown-value";

import { ClaimService } from "@/lib/backend/services/claim";
import { answering, refusal } from "@tests/helpers/api-answers";

/** The refusal of a project that already belongs to a team, naming that team. */
function alreadyClaimedBy(details: { team_id: string; dashboard_url: string }): Response {
  return HttpResponse.json(
    { code: "proj.already_claimed", message: "proj.already_claimed", details },
    { status: 409 },
  );
}

describe("ClaimService.start", () => {
  it("answers the claim link the server minted", async ({ server, client }) => {
    const started = answering(server, "createProjectClaim", { challenge_id: "clm_1" });

    await expect(new ClaimService(client, "proj_1").start()).resolves.toMatchObject({
      outcome: "started",
      challenge: { challenge_id: "clm_1" },
    });
    expect(
      started.map(({ params }) => {
        return params.project_id;
      }),
    ).toEqual(["proj_1"]);
  });

  it("reports a project whose claim window has closed", async ({ server, client }) => {
    answering(server, "createProjectClaim", refusal(410, "proj.claim_window_expired"));

    await expect(new ClaimService(client, "proj_1").start()).resolves.toEqual({
      outcome: "window-expired",
    });
  });

  it("reports a project that already belongs to a team, with its dashboard", async ({
    server,
    client,
  }) => {
    answering(
      server,
      "createProjectClaim",
      alreadyClaimedBy({
        team_id: "team_1",
        dashboard_url: "https://cloud.zitadel.com/team_1",
      }),
    );

    await expect(new ClaimService(client, "proj_1").start()).resolves.toEqual({
      outcome: "already-claimed",
      teamId: "team_1",
      dashboardUrl: "https://cloud.zitadel.com/team_1",
    });
  });

  it("raises a conflict whose body names no team, rather than reading one out of it", async ({
    server,
    client,
  }) => {
    answering(server, "createProjectClaim", refusal(409, "proj.already_claimed"));

    const error = await rejectionOf(() => new ClaimService(client, "proj_1").start());

    expect(error).toBeInstanceOf(ConflictError);
    expect(error).toMatchObject({ status: 409 });
  });

  it("raises any other failure", async ({ server, client }) => {
    answering(server, "createProjectClaim", refusal(500, "internal"));

    const error = await rejectionOf(() => new ClaimService(client, "proj_1").start());

    expect(error).toBeInstanceOf(UnavailableError);
    expect(error).toMatchObject({ status: 500 });
  });
});

describe("ClaimService.status", () => {
  it("answers a finished claim with what it finished as", async ({ server, client }) => {
    const polled = answering(server, "getProjectClaimStatus", { status: "completed" });

    await expect(new ClaimService(client, "proj_1").status("clm_1")).resolves.toMatchObject({
      outcome: "completed",
    });
    expect(
      polled.map(({ params, url }) => {
        return [params.project_id, url.searchParams.get("challenge_id")];
      }),
    ).toEqual([["proj_1", "clm_1"]]);
  });

  it("answers a claim nobody has followed yet as still waiting", async ({ server, client }) => {
    answering(server, "getProjectClaimStatus", { status: "pending" });

    await expect(new ClaimService(client, "proj_1").status("clm_1")).resolves.toEqual({
      outcome: "pending",
    });
  });

  it("reports a claim window that has closed", async ({ server, client }) => {
    answering(server, "getProjectClaimStatus", refusal(410, "proj.claim_window_expired"));

    await expect(new ClaimService(client, "proj_1").status("clm_1")).resolves.toEqual({
      outcome: "window-expired",
    });
  });

  it("reports a link that has expired, which is not the window closing", async ({
    server,
    client,
  }) => {
    answering(server, "getProjectClaimStatus", HttpResponse.json({}, { status: 410 }));

    await expect(new ClaimService(client, "proj_1").status("clm_1")).resolves.toEqual({
      outcome: "expired",
    });
  });

  it("reports a link the server has never heard of", async ({ server, client }) => {
    answering(server, "getProjectClaimStatus", refusal(404, "claim_challenge.not_found"));

    await expect(new ClaimService(client, "proj_1").status("clm_1")).resolves.toEqual({
      outcome: "not-found",
    });
  });

  it("reads a rate-limited poll as still waiting, so the caller keeps polling", async ({
    server,
    client,
  }) => {
    answering(server, "getProjectClaimStatus", refusal(429, "rate_limited"));

    await expect(new ClaimService(client, "proj_1").status("clm_1")).resolves.toEqual({
      outcome: "pending",
    });
  });

  it("raises any other failure", async ({ server, client }) => {
    answering(server, "getProjectClaimStatus", refusal(500, "internal"));

    const error = await rejectionOf(() => new ClaimService(client, "proj_1").status("clm_1"));

    expect(error).toBeInstanceOf(UnavailableError);
    expect(error).toMatchObject({ status: 500 });
  });
});
