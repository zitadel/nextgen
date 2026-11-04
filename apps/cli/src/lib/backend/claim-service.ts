import type { GetClaimStatus200, InitClaim201 } from "@zitadel/api/generated/model";

import type { ZitadelClient } from "./client";
import { BackendError } from "./errors";

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
export class ClaimService {
  private readonly client: ZitadelClient;
  private readonly projectId: string;

  constructor(client: ZitadelClient, projectId: string) {
    this.client = client;
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
      return Object.freeze({
        outcome: "started",
        challenge,
      });
    } catch (error) {
      if (!(error instanceof BackendError)) {
        throw error;
      }
      if (error.status === 410 && error.serverCode === "proj.claim_window_expired") {
        return Object.freeze({
          outcome: "window-expired",
        });
      }
      const owner = ClaimService.ownerOf(error);
      if (owner !== undefined) {
        return Object.freeze({
          outcome: "already-claimed",
          teamId: owner.teamId,
          dashboardUrl: owner.dashboardUrl,
        });
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
        return Object.freeze({
          outcome: "completed",
          claim: status,
        });
      }
      return Object.freeze({
        outcome: "pending",
      });
    } catch (error) {
      if (!(error instanceof BackendError)) {
        throw error;
      }
      if (error.status === 410 && error.serverCode === "proj.claim_window_expired") {
        return Object.freeze({
          outcome: "window-expired",
        });
      }
      if (error.status === 410) {
        return Object.freeze({
          outcome: "expired",
        });
      }
      if (error.status === 404 && error.serverCode === "claim_challenge.not_found") {
        return Object.freeze({
          outcome: "not-found",
        });
      }
      if (error.status === 429) {
        return Object.freeze({
          outcome: "pending",
        });
      }
      throw error;
    }
  }

  /**
   * Read the owning team off a `409 proj.already_claimed` response. The body is
   * read defensively, because a malformed error body would otherwise turn a
   * clean "already claimed" into a crash.
   */
  private static ownerOf(error: BackendError):
    | {
        teamId: string;
        dashboardUrl: string | undefined;
      }
    | undefined {
    if (error.status !== 409 || typeof error.body !== "object" || error.body === null) {
      return undefined;
    }
    const details = (
      error.body as {
        details?: unknown;
      }
    ).details;
    if (typeof details !== "object" || details === null) {
      return undefined;
    }
    const { team_id: teamId, dashboard_url: dashboardUrl } = details as {
      team_id?: unknown;
      dashboard_url?: unknown;
    };
    if (typeof teamId !== "string") {
      return undefined;
    }
    return {
      teamId,
      dashboardUrl: typeof dashboardUrl === "string" ? dashboardUrl : undefined,
    };
  }
}
