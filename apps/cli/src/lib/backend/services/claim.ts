import type { GetClaimStatus200, InitClaim201 } from "@zitadel/api/generated/model";

import type { ZitadelClient } from "@/lib/backend/client";
import { ApiService } from "@/lib/backend/api-service";
import { BackendError } from "@/lib/backend/errors";

/** A claim link, as the server mints it. */
export type ClaimChallenge = InitClaim201;

/** A claim that finished: the team that owns the project now. */
export type CompletedClaim = Extract<
  GetClaimStatus200,
  {
    status: "completed";
  }
>;

/**
 * What asking for a claim link came to.
 *
 * `window-expired` means the project outlived the time in which it could be
 * claimed, which no new link fixes.
 */
export type ClaimStart = Readonly<
  | {
      outcome: "started";
      challenge: ClaimChallenge;
    }
  | {
      outcome: "already-claimed";
      teamId: string;
      dashboardUrl: string | undefined;
    }
  | {
      outcome: "window-expired";
    }
>;

/**
 * Where a claim link stands.
 *
 * `expired` is the link running out, which a new link fixes. `window-expired`
 * is the project's claim window closing, which nothing fixes. `not-found` is a
 * challenge the server never minted for this project.
 */
export type ClaimProgress = Readonly<
  | {
      outcome: "completed";
      claim: CompletedClaim;
    }
  | {
      outcome: "pending";
    }
  | {
      outcome: "expired";
    }
  | {
      outcome: "window-expired";
    }
  | {
      outcome: "not-found";
    }
>;

/** The team a claimed project belongs to, as its refusal names it. */
type ClaimOwner = Readonly<{
  teamId: string;
  dashboardUrl: string | undefined;
}>;

/** Whether an error body carries the server's `details` object. */
function hasDetails(body: unknown): body is { details: unknown } {
  return typeof body === "object" && body !== null && "details" in body;
}

/** Whether a refusal's details name the team that holds the project. */
function isOwner(details: unknown): details is { team_id: string; dashboard_url?: string } {
  if (typeof details !== "object" || details === null || !("team_id" in details)) {
    return false;
  }
  if (typeof details.team_id !== "string") {
    return false;
  }
  return (
    !("dashboard_url" in details) ||
    typeof details.dashboard_url === "string" ||
    details.dashboard_url === undefined
  );
}

/**
 * The claim of one project: asking for the link that makes it permanent, and
 * following that link until someone finishes it.
 *
 * @remarks
 * A Service Layer (Fowler, PoEAA) over the generated API client, which plays
 * the Gateway: a command says what should happen and never which endpoint
 * serves it. Bound to one project at construction, so a call carries only what
 * is specific to it.
 *
 * The server answers several of these states with an error status. They are
 * outcomes of the claim, not failures, so they come back as values.
 */
export class ClaimService extends ApiService {
  private readonly projectId: string;

  /**
   * Bind the service to a client and the project every call concerns.
   *
   * @param client - The client every call goes through.
   * @param projectId - The project every call concerns.
   */
  constructor(client: ZitadelClient, projectId: string) {
    super(client);
    this.projectId = projectId;
  }

  /**
   * Ask for a claim link.
   *
   * @returns The link, or why there is none: the project already belongs to a
   * team, or its claim window closed.
   * @throws BackendError for any failure that is not one of those two outcomes.
   */
  async start(): Promise<ClaimStart> {
    try {
      const challenge = await this.client.initClaim(this.projectId);
      return {
        outcome: "started",
        challenge,
      };
    } catch (error) {
      if (!(error instanceof BackendError)) {
        throw error;
      }
      if (error.status === 410 && error.serverCode === "proj.claim_window_expired") {
        return {
          outcome: "window-expired",
        };
      }
      const owner = ClaimService.ownerOf(error);
      if (owner !== undefined) {
        return {
          outcome: "already-claimed",
          teamId: owner.teamId,
          dashboardUrl: owner.dashboardUrl,
        };
      }
      throw error;
    }
  }

  /**
   * Check where a claim link stands.
   *
   * @param challengeId - The link to follow.
   * @returns Whether it is finished, still waiting, or can never finish.
   * @throws BackendError for any failure that is not one of those states.
   */
  async status(challengeId: string): Promise<ClaimProgress> {
    try {
      const status = await this.client.getClaimStatus(this.projectId, {
        challenge_id: challengeId,
      });
      if (status.status === "completed") {
        return {
          outcome: "completed",
          claim: status,
        };
      }
      return {
        outcome: "pending",
      };
    } catch (error) {
      if (!(error instanceof BackendError)) {
        throw error;
      }
      if (error.status === 410 && error.serverCode === "proj.claim_window_expired") {
        return {
          outcome: "window-expired",
        };
      }
      if (error.status === 410) {
        return {
          outcome: "expired",
        };
      }
      if (error.status === 404 && error.serverCode === "claim_challenge.not_found") {
        return {
          outcome: "not-found",
        };
      }
      if (error.status === 429) {
        return {
          outcome: "pending",
        };
      }
      throw error;
    }
  }

  /**
   * Read the owning team off a `409 proj.already_claimed` response. The body is
   * checked against {@link isOwner} rather than trusted, because a malformed
   * error body would otherwise turn a clean "already claimed" into a crash.
   *
   * @param error - The failure to read.
   * @returns The owning team and its dashboard, or undefined when the body names none.
   */
  private static ownerOf(error: BackendError): ClaimOwner | undefined {
    if (error.status !== 409 || !hasDetails(error.body) || !isOwner(error.body.details)) {
      return undefined;
    }
    return {
      teamId: error.body.details.team_id,
      dashboardUrl: error.body.details.dashboard_url,
    };
  }
}
